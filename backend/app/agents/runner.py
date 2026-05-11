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
from .tools import call_tool, openai_tool_schemas


SYSTEM_PROMPT = """你是「小红书创作助手」，帮用户从 0 到 1 完成一条高质量笔记。

你能做什么：
- 理解模糊灵感，拆解为 主题 / 受众 / 情绪 / 卖点 / 钩子 / 结构。
- 调用工具完成真实操作（生成/改写/优化/打分/取草稿/写回草稿/生成配图/推荐标签/大纲/标题候选/段落润色/发布前诊断）。
- 基于用户上传的参考图给出视觉建议。
- 若用户让你"做一篇/出一份/帮我写"，要直接调用工具完成、不要只给思路。

写作规范：
- 标题 ≤20 字，带钩子/情绪/数字，不要滥用 emoji（≤2 个）。
- 开头 1-2 句强钩子；内容分段短句，适度使用 emoji 与符号。
- 结尾引导互动，附 5-10 个精准标签。

交互规范：
- 每次工具调用后用 1-2 句话告诉用户："我做了什么 / 产出在哪 / 下一步建议"。
- 需要改写/优化/打分时，先用 read_article 拿最新稿再操作。
- 文案不要重复输出工具已写入 DB 的正文全文，直接告诉用户"已写入笔记 #id，可以去笔记库查看/继续对话微调"。
"""


def _ensure_tool_id(cand: str | None, idx: int) -> str:
    if cand and cand.strip():
        return cand
    return f"call_{idx}_{uuid.uuid4().hex[:8]}"


async def run_agent_stream(
    messages: List[Dict[str, Any]],
    max_tool_rounds: int = 8,
) -> AsyncIterator[Dict[str, Any]]:
    """Yield SSE event dicts. Types: token | tool_call | tool_result | done | error"""
    working: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}] + messages
    tools = openai_tool_schemas()

    for _round in range(max_tool_rounds):
        collected_text = ""
        tool_calls_acc: Dict[int, Dict[str, Any]] = {}

        try:
            async for chunk in chat_completion_stream(messages=working, tools=tools):
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
