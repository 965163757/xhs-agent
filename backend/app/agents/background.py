"""Background agent execution decoupled from HTTP request lifecycle.

Spawns the agent loop as an asyncio task. Events are stored in an in-memory
list (for live SSE broadcast to multiple subscribers) and periodically flushed
to the Task row in the database (for reconnection after refresh).
"""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, AsyncIterator, Dict, List, Optional

from ..database import Conversation, SessionLocal, Task
from .runner import run_agent_stream


class TaskStream:
    """Append-only event log with broadcast notification."""

    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self._waiters: List[asyncio.Event] = []
        self.done = False

    def push(self, ev: Dict[str, Any]):
        self.events.append(ev)
        if ev.get("type") in ("done", "error"):
            self.done = True
        for w in self._waiters:
            w.set()
        self._waiters.clear()

    async def subscribe(self, from_index: int = 0) -> AsyncIterator[Dict[str, Any]]:
        """Yield events starting from from_index, waiting for new ones."""
        idx = from_index
        while True:
            while idx < len(self.events):
                ev = self.events[idx]
                idx += 1
                yield ev
                if ev.get("type") in ("done", "error"):
                    return
            if self.done:
                return
            waiter = asyncio.Event()
            self._waiters.append(waiter)
            try:
                await asyncio.wait_for(waiter.wait(), timeout=300)
            except asyncio.TimeoutError:
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    pass
                return


# In-memory registry
_streams: Dict[str, TaskStream] = {}
_running: Dict[str, bool] = {}


async def spawn_agent_task(
    messages: List[Dict[str, Any]],
    conversation_id: Optional[int] = None,
) -> str:
    """Create a Task row and spawn the agent loop in the background. Returns task_id."""
    task_id = uuid.uuid4().hex[:16]

    async with SessionLocal() as s:
        t = Task(id=task_id, conversation_id=conversation_id, status="running")
        s.add(t)
        if conversation_id:
            conv = await s.get(Conversation, conversation_id)
            if conv:
                conv.active_task_id = task_id
        await s.commit()

    stream = TaskStream()
    _streams[task_id] = stream
    _running[task_id] = True

    asyncio.create_task(_run_loop(task_id, messages, conversation_id, stream))
    return task_id


async def _run_loop(
    task_id: str,
    messages: List[Dict[str, Any]],
    conversation_id: Optional[int],
    stream: TaskStream,
):
    """Execute the agent stream, pushing events to the broadcast stream."""
    result_text = ""
    last_flush = time.time()
    status = "completed"

    try:
        async for ev in run_agent_stream(messages):
            stream.push(ev)

            if ev.get("type") == "token":
                result_text += ev.get("text", "")
            elif ev.get("type") == "error":
                status = "failed"

            now = time.time()
            if now - last_flush > 2.0:
                last_flush = now
                await _flush_events(task_id, stream.events, result_text)
    except Exception as e:
        stream.push({"type": "error", "message": str(e)})
        status = "failed"

    if not stream.done:
        stream.push({"type": "done", "text": result_text})

    await _finalize_task(task_id, conversation_id, stream.events, result_text, status)

    _running.pop(task_id, None)
    await asyncio.sleep(60)
    _streams.pop(task_id, None)


async def _flush_events(task_id: str, events: List[Dict[str, Any]], result_text: str):
    try:
        async with SessionLocal() as s:
            t = await s.get(Task, task_id)
            if t:
                t.events = list(events)
                t.result_text = result_text
                await s.commit()
    except Exception:
        pass


async def _finalize_task(
    task_id: str,
    conversation_id: Optional[int],
    events: List[Dict[str, Any]],
    result_text: str,
    status: str,
):
    """Mark task complete and write final assistant message to conversation."""
    try:
        async with SessionLocal() as s:
            t = await s.get(Task, task_id)
            if t:
                t.status = status
                t.events = list(events)
                t.result_text = result_text

            if conversation_id:
                conv = await s.get(Conversation, conversation_id)
                if conv:
                    conv.active_task_id = None
                    msgs = list(conv.messages or [])
                    if msgs and msgs[-1].get("role") == "assistant":
                        msgs[-1]["content"] = result_text
                        tool_events = []
                        for ev in events:
                            if ev.get("type") in ("tool_call", "tool_result"):
                                tool_events.append(ev)
                        if tool_events:
                            msgs[-1]["tool_events"] = tool_events
                    conv.messages = msgs
            await s.commit()
    except Exception:
        pass


def get_stream(task_id: str) -> Optional[TaskStream]:
    return _streams.get(task_id)


def is_running(task_id: str) -> bool:
    return _running.get(task_id, False)
