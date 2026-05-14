"""Agent conversation loop: streaming chat.completions + OpenAI tool calling.

Robust against gateways that only partially comply with OpenAI spec:
 - every tool_call id is guaranteed non-empty before being sent back
 - tool messages always carry tool_call_id
 - assistant message with tool_calls has content = null (spec)
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, List

from ..services.llm import chat_completion_stream
from ..config import Settings
from .tools import (
    call_tool,
    openai_tool_schemas,
    reset_tool_progress_emitter,
    set_tool_progress_emitter,
)


SYSTEM_PROMPT = """你是「小红书创作助手」，一位深谙小红书平台生态的全能内容创作伙伴。你帮用户从 0 到 1 完成高质量笔记，从选题到发布全流程覆盖。

## 核心能力

**内容创作：**
- 理解模糊灵感，拆解为 主题 / 受众 / 情绪 / 卖点 / 钩子 / 结构
- 调用工具完成真实操作：生成/改写/优化/打分/取草稿/写回草稿/推荐标签/大纲/标题候选/段落润色/发布前诊断
- 原创文案要基于用户提供的真实素材创作：如果用户给了房源信息、商品信息、房客评价/用户评价，调用 generate_article 或 create_complete_note_workflow 时把这些内容放进 source_material/listing_info/guest_reviews/extra，不要只传一个泛泛主题
- 民宿/酒店/房源类原创要从位置、景观、交通、设施、入住体验、周边玩法、房客评价高频亮点里提炼小红书种草点，写成用户视角体验，不要写成商家简介
- 改写不是缩写：调用 rewrite_article 时要在 instruction 里明确“重构标题钩子、开头视角、段落顺序和结尾互动，降低原帖连续文本/关键词重复，保留事实与图片匹配关系”
- 工具选择由你根据用户意图自主判断；不要机械匹配关键词，也不要把模糊需求强行兜底到某个工具。如果用户意图模糊，默认一次性反问所有影响执行的关键问题，不要猜测并直接执行高成本/写入/生图动作；但如果确实只有 1 个阻塞点，或问题太复杂需要先确定方向，可以只问 1 个最关键问题
- 当用户要"写一篇/做一篇/完成一篇小红书笔记/帖子/草稿/一键成稿/从0到1完整方案"时，通常调用 create_complete_note_workflow
- 当用户只要"封面方向/封面建议/配图方向/视觉方案/图片大纲/prompt"时，通常只是文字方案；是否真实生图取决于用户是否明确说要出图/生图/生成图片；如果说法介于二者之间，先一次性反问确认真实出图、数量/尺寸、是否写回笔记等必要项
- 当用户要实际生成图片、首图、配图、海报、头像、插画、参考图改图时，使用图片工具；如果不确定是要"方案"还是"真实出图"，先一次性反问，不要只问一个点
- 若用户只要标题/标签/大纲/润色/诊断，只调用对应单点工具，不要升级成完整工作流
- 搜索笔记（search_articles）、批量打分（batch_score）、批量优化（batch_optimize）、导出（export_articles）、统计（article_stats）、定时发布（schedule_publish）
- 需要“参考/模仿/仿写某篇笔记风格”时，先确认参考笔记 ID、新主题/目标笔记、是新建还是写回、是否需要同风格图片；参考笔记的主题不能被默认照搬，用户可能要从“北京”换成“上海”。缺少新主题且没有目标笔记时先反问，不要直接调用 imitate_article_style。信息完整后再调用 imitate_article_style；如果用户还明确要求图片同风格，设置 generate_images=true，默认用 edit_reference 让工具基于参考图调用 edit_image 做同风格变体

**图片创作：**
- 生成全新图片用 generate_image（不需要原图），prompt 用中文描述即可；如果用户只说"方向/建议/方案"，先一次性确认是否要真实出图、出几张、尺寸/比例、是否绑定到笔记
- 单纯生成图片默认是独立图片，不绑定文章，不创建帖子；除非用户明确说"放到笔记/作为某篇笔记封面/替换第N张图"
- 独立生成图片时，generate_image 参数只传 prompt/size/quality/n/reference_images；不要传 article_id、role、replace_index，也不要传 article_id=0
- 为已有笔记一次生成多张图片时，优先用 generate_article_images；它写入同一个小红书展示队列，队列第 1 张就是首图，后续是内容图，并返回每张图耗时/失败项。所谓 generate_cover 与 generate_content_images 只是“是否单独生成队列第 1 张”和“是否生成后续队列图”的区别，不代表两套割裂资产
- 图片默认按小红书 3:4 竖版、1.5K 长边（1152x1536）生成；如果用户指定 2K/4K、16:9、1:1、横版/竖版或精确尺寸，必须把要求传入 size/image_size/image_ratio，工具会转成对应 size（如 2K 3:4=1536x2048，4K 16:9=4096x2304）
- 任何已绑定图片都会按“小红书展示队列”理解：第 1 张就是首图/封面，后续是内容图；封面图和内容图不是两套割裂资产，只是队列位置不同
- 自然语言改图优先用 edit_image，不需要 mask。包括但不限于：重绘、保持主题结构不变、去掉/删除某个物体、增加人物/物品、替换局部元素、清晰度增强、改色调、换风格、同风格变体；把用户的局部位置/对象描述完整写进 prompt 即可
- inpaint_image/remove_object 是“精确蒙版编辑”工具，仅当用户已经提供/涂抹了 mask_url 或明确要求使用蒙版时才用；蒙版是可选增强，不是自然语言改图的必填条件
- 用户上传图片时，消息中会附带 [图片路径: /static/images/xxx.png]，直接用该路径作为 image_url 参数
- 多轮历史图片可能只保留路径而不重复附带像素；如果用户要继续编辑历史图，优先用路径调用 edit_image（自然语言改图）或 crop_image（裁剪）。只有用户已提供 mask_url 时才调用 inpaint_image/remove_object；只有需要重新看图做像素级判断但上下文未附带图片时，才请用户重新指定或上传
- edit_image 不需要 article_id，可独立使用；如需存到笔记，再传真实 article_id/role/replace_index，禁止传 article_id=0
- 用户要求“整体改成某风格/换成同风格变体/优化清晰度/改色调/去掉某物/添加某人或某物/局部替换但已用自然语言说明目标区域”时，优先用 edit_image，不要因为没有 mask 就反问；如果上游失败，要把 raw_error/elapsed_sec 讲清楚，并提示检查公网静态图片或网关 images.edit 兼容性
- 只有用户明确说“精确涂抹区域/按蒙版/只处理我圈出的区域”，或已经给了 mask_url，才询问/使用蒙版；否则不要把“请上传蒙版”作为阻塞条件
- 针对已有笔记图片编辑时，先 read_article 获取 image_context/visual_queue；若用户没说清目标图，需一次性确认要编辑第几张、怎么改、是否替换原位/另存为新图；第 1 张传 role=cover，后续图传 role=content + replace_index=位置-1

**帖子/笔记上下文规则：**
- read_article 返回完整笔记：title/body/tags/status/score/cover_image/images/image_context/content_stats；因此获取帖子内容时默认包含图片 URL、完整 full_url/model_url 和图片结构
- 当前编辑页的笔记只是默认上下文，不是强绑定；如果用户明确指定其它笔记 ID 或多个笔记，优先按用户指定 ID 调用 read_article / update_article / imitate_article_style / batch_* 等工具
- 当前笔记上下文总会列出图片 URL 和完整 URL；当任务涉及封面、配图、视觉诊断、图文匹配等图片意图时，会额外附带封面和最多前 5 张图片供视觉理解
- 工具返回的图片 URL 可用于后续 crop_image / edit_image / inpaint_image / remove_object；后续图片 replace_index 从 0 开始
- 改写/优化正文时不要忽略图片：需要保持文案与既有首图、后续图片、图片数量一致；如果图片缺失，主动建议补图或生成首图/后续图片

## 小红书平台认知

**流量分发逻辑：**
- 笔记发布后进入初始流量池（200-500 曝光），互动率决定是否进入下一级流量池
- 关键指标权重：收藏 > 评论 > 点赞 > 转发
- 标题含搜索关键词可获得长尾搜索流量
- 首图点击率直接影响曝光转化

**内容安全红线：**
- 绝对不碰：医疗承诺、金融收益保证、绝对化用语（最好/第一/唯一）
- 注意规避：引流外站、诱导私信、虚假对比、未标注广告
- 敏感词自查：减肥→身材管理，美白→提亮，祛痘→肌肤调理

## 写作方法论

**爆款公式：**
- 痛点+方案+结果：「熬夜脸暗沉？这个急救法 3 天见效」
- 反差冲击：「月薪 3k 的我，住出了月薪 3w 的感觉」
- 数字具象化：「5 个动作，腰围 -8cm」
- 悬念钩子：「后悔没早知道的 XX」

**标题公式（≤20 字）：**
- 带钩子/情绪/数字，不滥用 emoji（≤2 个）
- 包含 1-2 个搜索关键词

**正文结构：**
- 开头 1-2 句强钩子，制造共鸣或好奇
- 内容分段短句，善用 emoji 与符号做视觉分隔
- 结尾引导互动（提问/投票/求分享）
- 附 5-10 个精准标签

## 反问策略

- 反问默认一次性完成：把当前任务执行前必须知道的信息尽量合并在同一条回复里，避免无必要地分多轮逐个追问。
- 只问“阻塞执行”的问题，通常 2-5 个；如果只有 1 个真正阻塞点，可以只问 1 个。每个问题要短，并说明默认选项或可直接回复“按默认来”。
- 反问格式建议：先一句说明“我还差这些信息才能安全执行”，再用编号列出全部问题，最后给一个推荐默认方案。
- 如果缺失信息不影响执行，直接采用合理默认值并在结果里说明，不要为了细枝末节反问。
- 对高成本/不可撤销动作（真实出图、发布、删除、覆盖写回）如果必须确认，优先一次性确认动作、目标对象、数量/范围、写回方式；如果只缺一个关键确认项，可以只问这个问题。

## 交互规范

- 若用户让你"做一篇笔记/写一篇小红书/完成一篇小红书笔记/出一篇帖子/生成草稿"，通常调用 create_complete_note_workflow；如果同时要求标题候选、标签、封面方向、发布前自检，这仍然是一键成稿中的视觉方案，不等同于真实生图
- 不要因为用户说"生成/做一个"就默认执行；先判断对象：对象是"图片/首图/配图/海报"时才用图片工具，对象是"笔记/帖子/文案"时才进入内容工作流；判断不清时先一次性反问清楚对象、范围和交付形式
- 遇到“帮我处理一下/优化一下/按这个来/做成小红书风格”等缺少对象、范围或写入目标的表达时，不要猜；一次性问清楚是要文字方案、写回哪篇笔记、是否真实出图、出图数量/尺寸、还是完整成稿
- 用户没有指定发布/笔记/帖子时，不要把图片生成绑定到文章
- 每次工具调用后用 1-2 句话告诉用户："我做了什么 / 产出在哪 / 下一步建议"
- 需要改写/优化/打分时，先用 read_article 拿最新稿再操作
- 当用户问"这篇/当前帖子内容是什么、有哪些图、图文是否匹配"时，先 read_article，再基于 article.image_context 回答
- 当用户说“参考这篇/按某篇风格仿写/像这篇一样写/仿图”时，先 read_article 确认参考笔记；若没有明确新主题/目标笔记/写回方式，先一次性反问。确认后调用 imitate_article_style；不要手写一段建议替代真实写回
- 图片以小红书展示队列理解：第 1 张就是首图/封面，后续是内容图。不要再区分“单独封面”和“内容图首张”两个概念；用户说"把这张图设为封面/移到第一张/放到第二张内容图/调换顺序"时，优先调用 arrange_article_images，不要只改文案。
- 文案不要重复输出工具已写入 DB 的正文全文，直接告诉用户"已写入笔记 #id"
- 基于用户上传的参考图给出视觉建议时，要具体到构图、色调、元素
- 需要真实出图、发布、批量删除、覆盖写回等不可轻易撤销或高成本动作时，如果用户表达模糊，优先一次性列出必要确认项；若只有一个关键风险点，可只问一个问题
"""


def _ensure_tool_id(cand: str | None, idx: int) -> str:
    if cand and cand.strip():
        return cand
    return f"call_{idx}_{uuid.uuid4().hex[:8]}"


def _short_text(value: Any, limit: int = 1800) -> str:
    text = value if isinstance(value, str) else str(value or "")
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _safe_int(value: Any, default: int, *, min_value: int | None = None, max_value: int | None = None) -> int:
    try:
        out = int(value)
    except Exception:
        out = default
    if min_value is not None:
        out = max(min_value, out)
    if max_value is not None:
        out = min(max_value, out)
    return out


_IMAGE_REFERENCE_RE = re.compile(
    r"(图片|图像|照片|图|封面|配图|海报|视觉|画面|构图|排版|设计|参考图|上传|"
    r"改图|编辑图|裁剪|重绘|消除|清晰|放大|换风格|仿图|模仿|"
    r"去掉|删除|移除|擦掉|增加|添加|替换|换成|"
    r"这张|那张|上一张|第一张|第二张|刚才|上面|前面|继续)",
    re.IGNORECASE,
)


def _message_images(msg: Dict[str, Any]) -> List[str]:
    return [str(x).strip() for x in (msg.get("images") or []) if str(x or "").strip()]


def _has_image_reference_intent(text: Any) -> bool:
    return bool(_IMAGE_REFERENCE_RE.search(str(text or "")))


def _is_article_context_message(msg: Dict[str, Any]) -> bool:
    content = str(msg.get("content") or "")
    return content.startswith("【当前笔记上下文")


def _with_image_path_hints(content: Any, images: List[str]) -> str:
    text = str(content or "")
    missing = [url for url in images if url and url not in text]
    if not missing:
        return text
    hints = "\n".join(f"[历史图片路径: {url}]" for url in missing)
    suffix = "历史图片仅保留路径，未在本轮作为视觉像素重复发送；如需改图可直接把该路径传给图片工具。"
    return (text + "\n" if text else "") + hints + "\n" + suffix


def _optimize_history_image_context(
    items: List[Dict[str, Any]],
    *,
    server_public_images: bool = False,
) -> List[Dict[str, Any]]:
    """Limit repeated vision payloads while preserving image paths for tools.

    Local mode converts images to data URLs, so repeated historical images are
    expensive. Server mode can pass public URLs, so it can keep a few more. In
    both modes the newest uploaded images and article-context visual images stay
    attached; stripped images remain as explicit paths in text so tools can still
    operate on them.
    """
    if not items:
        return items

    latest_user_idx = next(
        (i for i in range(len(items) - 1, -1, -1) if items[i].get("role") == "user" and not _is_article_context_message(items[i])),
        None,
    )
    latest_text = items[latest_user_idx].get("content") if latest_user_idx is not None else ""
    wants_image_context = _has_image_reference_intent(latest_text)
    max_prior_messages = 4 if server_public_images else 2
    max_prior_images = 8 if server_public_images else 4

    keep: set[int] = set()
    if latest_user_idx is not None:
        keep.add(latest_user_idx)

    for i, msg in enumerate(items):
        if _is_article_context_message(msg) and _message_images(msg):
            # This synthetic context is only populated with images when the
            # current user request is visual/image-related. Keep it as intended.
            keep.add(i)

    if wants_image_context and latest_user_idx is not None:
        kept_prior_messages = 0
        kept_prior_images = 0
        for i in range(latest_user_idx - 1, -1, -1):
            imgs = _message_images(items[i])
            if not imgs or _is_article_context_message(items[i]):
                continue
            if kept_prior_messages >= max_prior_messages or kept_prior_images >= max_prior_images:
                break
            keep.add(i)
            kept_prior_messages += 1
            kept_prior_images += len(imgs)

    optimized: List[Dict[str, Any]] = []
    for i, msg in enumerate(items):
        item = dict(msg)
        imgs = _message_images(item)
        if imgs and i not in keep:
            item["content"] = _with_image_path_hints(item.get("content"), imgs)
            item["images"] = []
        optimized.append(item)
    return optimized


def _compact_tool_result_for_context(result: Any, *, limit: int = 8000) -> Any:
    """Keep the model-facing tool result concise while preserving user-visible SSE result.

    Large diagnostics/articles can otherwise dominate the next model turn.
    The full result is still emitted to the frontend; only the message sent back
    to the model is compacted.
    """
    if not isinstance(result, dict):
        return result

    compact: Dict[str, Any] = {}
    for key in ("ok", "error", "timeout", "elapsed_ms", "elapsed_sec", "article_id", "count"):
        if key in result:
            compact[key] = result[key]

    article = result.get("article")
    if isinstance(article, dict):
        compact["article"] = {
            "id": article.get("id"),
            "title": article.get("title"),
            "status": article.get("status"),
            "tags": article.get("tags"),
            "cover_image": article.get("cover_image"),
            "images": (article.get("images") or [])[:8],
            "image_context": article.get("image_context"),
            "content_stats": article.get("content_stats"),
        }

    if isinstance(result.get("images"), list):
        compact["images"] = result["images"][:8]
    if isinstance(result.get("generated_content_images"), list):
        compact["generated_content_images"] = result["generated_content_images"][:8]
    if result.get("generated_cover"):
        compact["generated_cover"] = result.get("generated_cover")
    if result.get("first_image_is_cover") is not None:
        compact["first_image_is_cover"] = result.get("first_image_is_cover")
    if isinstance(result.get("visual_queue"), list):
        compact["visual_queue"] = result["visual_queue"][:8]
    if isinstance(result.get("image_errors"), list):
        compact["image_errors"] = result["image_errors"][:5]
    if isinstance(result.get("image_results"), list):
        compact["image_results"] = result["image_results"][:6]
    if isinstance(result.get("image_attempts"), list):
        compact["image_attempts"] = result["image_attempts"][:8]
    if result.get("used_image_model"):
        compact["used_image_model"] = result.get("used_image_model")
    if isinstance(result.get("style_profile"), dict):
        compact["style_profile"] = result["style_profile"]
    if isinstance(result.get("image_plan"), list):
        compact["image_plan"] = result["image_plan"][:6]

    for key in (
        "score",
        "titles",
        "tags",
        "outline",
        "cover",
        "diagnostic",
        "suggestions",
        "changelog",
        "workflow",
        "message",
    ):
        if key in result and key not in compact:
            compact[key] = result[key]

    if isinstance(result.get("items"), list):
        compact["items"] = [
            {
                "id": x.get("id"),
                "title": x.get("title"),
                "status": x.get("status"),
                "updated_at": x.get("updated_at"),
                "image_count": ((x.get("content_stats") or {}).get("image_count") if isinstance(x, dict) else None),
            }
            if isinstance(x, dict) else x
            for x in result["items"][:12]
        ]
        compact["total_items_returned"] = len(result["items"])

    if not compact:
        compact = result

    text = json.dumps(compact, ensure_ascii=False)
    if len(text) <= limit:
        return compact
    return {
        "ok": compact.get("ok", result.get("ok", True)),
        "summary": _short_text(text, limit),
        "note": "tool result compacted for model context; full result was sent to UI",
    }


def _compact_input_messages(
    messages: List[Dict[str, Any]],
    *,
    keep_recent: int = 18,
    max_total_chars: int = 18_000,
    server_public_images: bool = False,
) -> List[Dict[str, Any]]:
    """Keep chat context useful while preventing long conversations from bloating prompts.

    - Explicit system messages (for memory/user profile) are preserved.
    - Old user/assistant turns are folded into a compact system summary.
    - Recent turns are kept verbatim except very long content is truncated.
    """
    system_msgs: List[Dict[str, Any]] = []
    dialog_msgs: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "system":
            system_msgs.append({"role": "system", "content": _short_text(msg.get("content"), 2200)})
        else:
            dialog_msgs.append(dict(msg))

    older = dialog_msgs[:-keep_recent] if len(dialog_msgs) > keep_recent else []
    recent = dialog_msgs[-keep_recent:] if len(dialog_msgs) > keep_recent else dialog_msgs

    compacted: List[Dict[str, Any]] = list(system_msgs)
    if older:
        lines = []
        for msg in older[-30:]:
            role = msg.get("role", "user")
            content = _short_text(msg.get("content"), 260).replace("\n", " ")
            if content:
                lines.append(f"{role}: {content}")
        if lines:
            compacted.append(
                {
                    "role": "system",
                    "content": "以下是较早对话的压缩摘要，仅作上下文参考：\n" + "\n".join(lines),
                }
            )

    recent_items: List[Dict[str, Any]] = []
    for msg in recent:
        item = dict(msg)
        item["content"] = _short_text(item.get("content"), 3000)
        recent_items.append(item)

    compacted.extend(_optimize_history_image_context(recent_items, server_public_images=server_public_images))

    # Hard budget guard, dropping oldest non-system turns first if needed.
    def total_chars(items: List[Dict[str, Any]]) -> int:
        return sum(len(str(x.get("content") or "")) for x in items)

    while total_chars(compacted) > max_total_chars:
        drop_idx = next((i for i, x in enumerate(compacted) if x.get("role") != "system"), None)
        if drop_idx is None:
            break
        compacted.pop(drop_idx)
    return compacted


async def run_agent_stream(
    messages: List[Dict[str, Any]],
    max_tool_rounds: int = 12,
    settings: Settings | None = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield SSE event dicts. Types: token | tool_call | tool_result | done | error"""
    server_public_images = bool(settings and str(getattr(settings, "public_base_url", "") or "").strip())
    working: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}] + _compact_input_messages(
        messages,
        server_public_images=server_public_images,
    )
    tools = openai_tool_schemas()
    for _round in range(max_tool_rounds):
        collected_text = ""
        tool_calls_acc: Dict[int, Dict[str, Any]] = {}

        try:
            async for chunk in chat_completion_stream(messages=working, tools=tools, settings=settings):
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                delta = choice.delta
                if delta and delta.content:
                    collected_text += delta.content
                    yield {"type": "token", "text": delta.content}
                if delta and getattr(delta, "tool_calls", None):
                    for tc in delta.tool_calls:
                        idx = tc.index if tc.index is not None else 0
                        slot = tool_calls_acc.setdefault(
                            idx, {"id": None, "name": "", "arguments": ""}
                        )
                        if tc.id:
                            slot["id"] = tc.id
                        if tc.function:
                            if tc.function.name:
                                slot["name"] += tc.function.name
                            if tc.function.arguments:
                                slot["arguments"] += tc.function.arguments
        except Exception as e:
            yield {"type": "error", "message": f"模型调用失败: {e}"}
            return

        if not tool_calls_acc:
            yield {"type": "done", "text": collected_text}
            return

        # Assemble assistant message exactly from the model's tool calls.  We
        # only repair missing tool_call ids and invalid JSON; routing remains
        # the model's responsibility so ambiguous intent can be clarified in
        # natural language instead of being forced into a fallback tool.
        ordered = sorted(tool_calls_acc.items())
        prepared_calls: List[tuple[str, str, Dict[str, Any]]] = []
        assistant_tool_calls: List[Dict[str, Any]] = []
        for i, slot in ordered:
            tid = _ensure_tool_id(slot["id"], i)
            name = slot["name"] or "unknown"
            try:
                args = json.loads(slot["arguments"] or "{}")
            except Exception:
                args = {}
            prepared_calls.append((tid, name, args))
            assistant_tool_calls.append(
                {
                    "id": tid,
                    "type": "function",
                    "function": {
                        "name": name,
                        "arguments": json.dumps(args, ensure_ascii=False),
                    },
                }
            )

        working.append(
            {
                "role": "assistant",
                # Spec: content must be null (not empty string) when tool_calls present
                "content": None,
                "tool_calls": assistant_tool_calls,
            }
        )

        # Execute every tool call and append tool messages in the SAME order
        for tid, name, args in prepared_calls:
            yield {"type": "tool_call", "name": name, "arguments": args, "id": tid}
            progress_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()

            def emit_progress(ev: Dict[str, Any]) -> None:
                payload = dict(ev)
                payload.setdefault("type", "tool_progress")
                payload.setdefault("name", name)
                payload.setdefault("id", tid)
                progress_queue.put_nowait(payload)

            token = set_tool_progress_emitter(emit_progress)
            tool_started = time.perf_counter()
            task = asyncio.create_task(call_tool(name, args))
            try:
                while not task.done():
                    try:
                        progress_ev = await asyncio.wait_for(progress_queue.get(), timeout=0.2)
                        yield progress_ev
                    except asyncio.TimeoutError:
                        pass
                result = await task
                while not progress_queue.empty():
                    yield progress_queue.get_nowait()
            except asyncio.CancelledError:
                task.cancel()
                raise
            except Exception as e:
                result = {"ok": False, "error": str(e)}
            finally:
                reset_tool_progress_emitter(token)
            elapsed_ms = int((time.perf_counter() - tool_started) * 1000)
            if isinstance(result, dict):
                result.setdefault("elapsed_ms", elapsed_ms)
                result.setdefault("elapsed_sec", round(elapsed_ms / 1000, 2))
            ok = bool(result.get("ok", True)) if isinstance(result, dict) else True
            yield {
                "type": "tool_result",
                "name": name,
                "result": result,
                "id": tid,
                "elapsed_ms": elapsed_ms,
                "ok": ok,
            }

            working.append(
                {
                    "role": "tool",
                    "tool_call_id": tid,
                    "name": name,
                    "content": json.dumps(_compact_tool_result_for_context(result), ensure_ascii=False),
                }
            )
        # loop — let the model respond after the tool results

    yield {
        "type": "error",
        "message": (
            f"本轮自动操作已达到安全上限（{max_tool_rounds} 次工具调用）。"
            "我已保留当前进度，请发送“继续”来执行剩余步骤，或到任务中心查看已完成结果。"
        ),
    }
