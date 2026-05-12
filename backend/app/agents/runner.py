"""Agent conversation loop: streaming chat.completions + OpenAI tool calling.

Robust against gateways that only partially comply with OpenAI spec:
 - every tool_call id is guaranteed non-empty before being sent back
 - tool messages always carry tool_call_id
 - assistant message with tool_calls has content = null (spec)
"""
from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator, Dict, List

from ..services.llm import chat_completion_stream
from ..config import Settings
from .tools import call_tool, openai_tool_schemas


SYSTEM_PROMPT = """你是「小红书创作助手」，一位深谙小红书平台生态的全能内容创作伙伴。你帮用户从 0 到 1 完成高质量笔记，从选题到发布全流程覆盖。

## 核心能力

**内容创作：**
- 理解模糊灵感，拆解为 主题 / 受众 / 情绪 / 卖点 / 钩子 / 结构
- 调用工具完成真实操作：生成/改写/优化/打分/取草稿/写回草稿/推荐标签/大纲/标题候选/段落润色/发布前诊断
- 搜索笔记（search_articles）、批量打分（batch_score）、批量优化（batch_optimize）、导出（export_articles）、统计（article_stats）、定时发布（schedule_publish）

**图片创作：**
- 生成全新图片用 generate_image（不需要原图），prompt 用中文描述即可
- 局部修改用 inpaint_image（需要 mask 蒙版）
- 整体风格化/变体用 edit_image
- 用户上传图片时，消息中会附带 [图片路径: /static/images/xxx.png]，直接用该路径作为 image_url 参数
- edit_image 不需要 article_id，可独立使用；如需存到笔记，再传 article_id/role/replace_index

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

- 若用户让你"做一篇/出一份/帮我写"，直接调用工具完成，不要只给思路
- 每次工具调用后用 1-2 句话告诉用户："我做了什么 / 产出在哪 / 下一步建议"
- 需要改写/优化/打分时，先用 read_article 拿最新稿再操作
- 文案不要重复输出工具已写入 DB 的正文全文，直接告诉用户"已写入笔记 #id"
- 基于用户上传的参考图给出视觉建议时，要具体到构图、色调、元素
"""


def _ensure_tool_id(cand: str | None, idx: int) -> str:
    if cand and cand.strip():
        return cand
    return f"call_{idx}_{uuid.uuid4().hex[:8]}"


async def run_agent_stream(
    messages: List[Dict[str, Any]],
    max_tool_rounds: int = 8,
    settings: Settings | None = None,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield SSE event dicts. Types: token | tool_call | tool_result | done | error"""
    working: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
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

        # Assemble assistant message
        ordered = sorted(tool_calls_acc.items())
        assistant_tool_calls: List[Dict[str, Any]] = []
        resolved_ids: List[str] = []
        for i, slot in ordered:
            tid = _ensure_tool_id(slot["id"], i)
            resolved_ids.append(tid)
            assistant_tool_calls.append(
                {
                    "id": tid,
                    "type": "function",
                    "function": {
                        "name": slot["name"] or "unknown",
                        "arguments": slot["arguments"] or "{}",
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
        for (i, slot), tid in zip(ordered, resolved_ids):
            name = slot["name"] or "unknown"
            try:
                args = json.loads(slot["arguments"] or "{}")
            except Exception:
                args = {}

            yield {"type": "tool_call", "name": name, "arguments": args, "id": tid}
            try:
                result = await call_tool(name, args)
            except Exception as e:
                result = {"ok": False, "error": str(e)}
            yield {"type": "tool_result", "name": name, "result": result, "id": tid}

            working.append(
                {
                    "role": "tool",
                    "tool_call_id": tid,
                    "name": name,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )
        # loop — let the model respond after the tool results

    yield {"type": "error", "message": "已达到最大工具调用轮数"}
