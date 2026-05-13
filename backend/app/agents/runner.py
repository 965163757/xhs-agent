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
- 只有当用户明确要"写一篇完整笔记/一键成稿/从0到1做完整方案/生成帖子/生成草稿"时，才调用 create_complete_note_workflow
- 若用户只要图片、封面、配图、海报、头像、插画、参考图改图，不要创建笔记/帖子，不要调用 create_complete_note_workflow；只调用 generate_image / edit_image / inpaint_image / remove_object
- 若用户只要标题/标签/大纲/润色/诊断，只调用对应单点工具，不要升级成完整工作流
- 搜索笔记（search_articles）、批量打分（batch_score）、批量优化（batch_optimize）、导出（export_articles）、统计（article_stats）、定时发布（schedule_publish）

**图片创作：**
- 生成全新图片用 generate_image（不需要原图），prompt 用中文描述即可
- 单纯生成图片默认是独立图片，不绑定文章，不创建帖子；除非用户明确说"放到笔记/作为某篇笔记封面/替换第N张图"
- 独立生成图片时，generate_image 参数只传 prompt/size/quality/n/reference_images；不要传 article_id、role、replace_index，也不要传 article_id=0
- 为已有笔记一次生成多张封面/内容配图时，优先用 generate_article_images；它会并发生成内容图、自动绑定到笔记，并返回每张图耗时/失败项
- 任何已绑定图片都会按“小红书展示队列”理解：第 1 张就是首图/封面；即使 generated_cover 不是单独生成的，只要 article.cover_image / image_context.cover_image 有值，就不要说“没有封面”
- 局部修改用 inpaint_image（需要 mask 蒙版）
- 整体风格化/变体用 edit_image
- 用户上传图片时，消息中会附带 [图片路径: /static/images/xxx.png]，直接用该路径作为 image_url 参数
- edit_image 不需要 article_id，可独立使用；如需存到笔记，再传 article_id/role/replace_index

**帖子/笔记上下文规则：**
- read_article 返回完整笔记：title/body/tags/status/score/cover_image/images/image_context/content_stats；因此获取帖子内容时默认包含图片 URL 和图片结构
- 当前笔记上下文总会列出图片 URL；当任务涉及封面、配图、视觉诊断、图文匹配等图片意图时，会额外附带封面和最多前 5 张图片供视觉理解
- 工具返回的图片 URL 可用于后续 crop_image / edit_image / inpaint_image / remove_object；内容图 replace_index 从 0 开始
- 改写/优化正文时不要忽略图片：需要保持文案与既有封面、内容图、图片数量一致；如果图片缺失，主动建议补图或生成封面/内容图

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

## 交互规范

- 若用户让你"做一篇笔记/写一篇小红书/出一篇帖子/生成草稿"，直接调用 create_complete_note_workflow，不要只给思路
- 不要因为用户说"生成/做一个"就默认成稿；先判断对象：对象是"图片/封面/配图/海报"时只生成图片，对象是"笔记/帖子/文案"时才进入内容工作流
- 用户没有指定发布/笔记/帖子时，不要把图片生成绑定到文章
- 每次工具调用后用 1-2 句话告诉用户："我做了什么 / 产出在哪 / 下一步建议"
- 需要改写/优化/打分时，先用 read_article 拿最新稿再操作
- 当用户问"这篇/当前帖子内容是什么、有哪些图、图文是否匹配"时，先 read_article，再基于 article.image_context 回答
- 图片以小红书展示队列理解：第 1 张就是首图/封面，后续是内容图。不要再区分“单独封面”和“内容图首张”两个概念；用户说"把这张图设为封面/移到第一张/放到第二张内容图/调换顺序"时，优先调用 arrange_article_images，不要只改文案。
- 文案不要重复输出工具已写入 DB 的正文全文，直接告诉用户"已写入笔记 #id"
- 基于用户上传的参考图给出视觉建议时，要具体到构图、色调、元素
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


_IMAGE_INTENT_RE = re.compile(
    r"(图片|图像|配图|封面图?|海报|插画|头像|壁纸|logo|参考图|画一张|一张图|生成图|生图|绘制|画个|画一个)",
    re.I,
)
_COMPLETE_NOTE_RE = re.compile(
    r"(一键成稿|完整(笔记|帖子|文章|文案)|从0到1|草稿|正文|标题.*正文|标签.*正文|写一篇|做一篇|出一篇|起草.*(笔记|帖子|文章|文案)|生成.*(笔记|帖子|文章|文案))",
    re.I,
)
_NEGATED_NOTE_CREATE_RE = re.compile(
    r"(不要|不用|不需要|无需|不必|别|不一定要).{0,12}(生成|创建|写|做|出|成稿).{0,8}(笔记|帖子|文章|文案|草稿)",
    re.I,
)
_ARTICLE_BINDING_RE = re.compile(
    r"(当前笔记|这篇笔记|该笔记|这条笔记|笔记\s*#?\d+|文章\s*#?\d+|帖子\s*#?\d+|绑定|放到|加到|插入|替换|更新封面|作为.*(封面|配图))",
    re.I,
)


def _latest_user_text(messages: List[Dict[str, Any]]) -> str:
    """Return the real latest user turn, ignoring synthetic context prefaces when possible."""
    for msg in reversed(messages):
        if msg.get("role") != "user":
            continue
        content = str(msg.get("content") or "")
        if content.startswith("【当前笔记上下文"):
            continue
        return content
    return ""


def _is_image_focused_request(text: str) -> bool:
    return bool(_IMAGE_INTENT_RE.search(text or ""))


def _wants_complete_note(text: str) -> bool:
    if _NEGATED_NOTE_CREATE_RE.search(text or ""):
        return False
    return bool(_COMPLETE_NOTE_RE.search(text or ""))


def _allows_article_image_binding(text: str) -> bool:
    return bool(_ARTICLE_BINDING_RE.search(text or ""))


def _coerce_tool_call_for_intent(
    name: str,
    args: Dict[str, Any],
    latest_user_text: str,
) -> tuple[str, Dict[str, Any]]:
    """Deterministic guardrail for common over-eager tool routing.

    The model sometimes treats "生成一张图/封面/海报" as a full note creation
    request.  The product rule is stricter: image-only requests must stay in
    the image tool, and independent image generation must not bind to an
    article just because the chat currently has article context.
    """
    safe_args = dict(args or {})
    image_focused = _is_image_focused_request(latest_user_text)
    wants_complete_note = _wants_complete_note(latest_user_text)

    if name == "create_complete_note_workflow" and image_focused and not wants_complete_note:
        prompt = (
            safe_args.get("prompt")
            or safe_args.get("topic")
            or safe_args.get("brief")
            or latest_user_text
        )
        coerced: Dict[str, Any] = {
            "prompt": str(prompt or latest_user_text).strip(),
            "size": safe_args.get("size") or "1024x1536",
            "quality": safe_args.get("quality") or "high",
            "n": _safe_int(safe_args.get("n") or 1, 1, min_value=1, max_value=4),
        }
        if safe_args.get("reference_images"):
            coerced["reference_images"] = safe_args.get("reference_images")
        return "generate_image", coerced

    if name == "generate_image" and not _allows_article_image_binding(latest_user_text):
        # Independent image generation must not create/bind a post implicitly.
        for k in ("article_id", "role", "replace_index"):
            safe_args.pop(k, None)

    return name, safe_args


def _compact_input_messages(
    messages: List[Dict[str, Any]],
    *,
    keep_recent: int = 18,
    max_total_chars: int = 18_000,
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

    for msg in recent:
        item = dict(msg)
        item["content"] = _short_text(item.get("content"), 3000)
        compacted.append(item)

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
    max_tool_rounds: int = 8,
    settings: Settings | None = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield SSE event dicts. Types: token | tool_call | tool_result | done | error"""
    working: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}] + _compact_input_messages(messages)
    tools = openai_tool_schemas()
    latest_text = _latest_user_text(messages)

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

        # Assemble assistant message.  Tool calls are normalized before they are
        # written back to the model context so any deterministic routing guard
        # stays spec-consistent with the following tool result.
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
            name, args = _coerce_tool_call_for_intent(name, args, latest_text)
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

    yield {"type": "error", "message": "已达到最大工具调用轮数"}
