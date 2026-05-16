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

from sqlalchemy import select

from ..database import Conversation, SessionLocal, Task, UserMemory
from ..time_utils import beijing_now_iso
from .runner import run_agent_stream


MAX_RUNNING_TASKS_PER_USER = 2
TRACE_FLUSH_INTERVAL_SECONDS = 2.0
STREAM_RETENTION_SECONDS = 60
MAX_MEMORY_BRIEFS = 20
ARTICLE_BINDING_TOOL_NAMES = {
    "generate_article",
    "create_complete_note_workflow",
    "create_article",
    "imitate_article_style",
    "rewrite_article",
    "optimize_article",
    "update_article",
    "apply_template",
    "generate_article_images",
    "arrange_article_images",
    "edit_image",
    "crop_image",
    "inpaint_image",
    "remove_object",
    "remove_image",
}


class TaskStream:
    """Append-only event log with broadcast notification."""

    def __init__(self):
        self.events: List[Dict[str, Any]] = []
        self._waiters: List[asyncio.Event] = []
        self.done = False

    def push(self, ev: Dict[str, Any]):
        ev = dict(ev)
        ev.setdefault("seq", len(self.events))
        self.events.append(ev)
        if ev.get("type") in ("done", "error", "cancelled"):
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
                if ev.get("type") in ("done", "error", "cancelled"):
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
            except asyncio.CancelledError:
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    pass
                raise


# In-memory registry
_streams: Dict[str, TaskStream] = {}
_running: Dict[str, bool] = {}
_task_handles: Dict[str, asyncio.Task] = {}
_task_users: Dict[str, Optional[int]] = {}
_cancelled: set[str] = set()


def _now_iso() -> str:
    return beijing_now_iso()


def _truncate(text: Any, limit: int = 800) -> str:
    s = text if isinstance(text, str) else str(text or "")
    s = s.strip()
    return s if len(s) <= limit else s[: limit - 1] + "…"


def _safe_article_id_from_result(result: Any) -> Optional[int]:
    if not isinstance(result, dict):
        return None
    candidates = [
        ((result.get("article") or {}).get("id") if isinstance(result.get("article"), dict) else None),
        result.get("article_id"),
        ((result.get("workflow") or {}).get("article_id") if isinstance(result.get("workflow"), dict) else None),
        (((result.get("workflow") or {}).get("article") or {}).get("id") if isinstance(result.get("workflow"), dict) and isinstance((result.get("workflow") or {}).get("article"), dict) else None),
    ]
    for value in candidates:
        try:
            aid = int(value or 0)
        except Exception:
            aid = 0
        if aid > 0:
            return aid
    return None


def _latest_bound_article_id(events: List[Dict[str, Any]]) -> Optional[int]:
    for ev in reversed(events or []):
        if ev.get("type") != "tool_result" or ev.get("name") not in ARTICLE_BINDING_TOOL_NAMES:
            continue
        aid = _safe_article_id_from_result(ev.get("result"))
        if aid:
            return aid
    return None


def _new_trace(
    task_id: str,
    trace_id: str,
    conversation_id: Optional[int],
    user_id: Optional[int],
) -> Dict[str, Any]:
    return {
        "trace_id": trace_id,
        "task_id": task_id,
        "user_id": user_id,
        "conversation_id": conversation_id,
        "status": "running",
        "created_at": _now_iso(),
        "model": {},
        "timings_ms": {},
        "event_counts": {},
        "tools": [],
        "errors": [],
        "token_chars": 0,
    }


def _count_event(trace: Dict[str, Any], event_type: str) -> None:
    counts = trace.setdefault("event_counts", {})
    counts[event_type] = int(counts.get(event_type, 0)) + 1


def _running_count_for_user(user_id: Optional[int]) -> int:
    if user_id is None:
        return 0
    return sum(1 for uid in _task_users.values() if uid == user_id)


async def spawn_agent_task(
    messages: List[Dict[str, Any]],
    conversation_id: Optional[int] = None,
    user_id: Optional[int] = None,
    request_public_base_url: str = "",
) -> str:
    """Create a Task row and spawn the agent loop in the background. Returns task_id."""
    if user_id is not None and _running_count_for_user(user_id) >= MAX_RUNNING_TASKS_PER_USER:
        raise RuntimeError(f"同一用户最多同时运行 {MAX_RUNNING_TASKS_PER_USER} 个 Agent 任务")

    task_id = uuid.uuid4().hex[:16]
    trace_id = uuid.uuid4().hex[:12]
    trace = _new_trace(task_id, trace_id, conversation_id, user_id)

    async with SessionLocal() as s:
        t = Task(
            id=task_id,
            user_id=user_id,
            conversation_id=conversation_id,
            status="running",
            trace_id=trace_id,
            trace=trace,
        )
        s.add(t)
        if conversation_id:
            conv = await s.get(Conversation, conversation_id)
            if conv:
                conv.active_task_id = task_id
        await s.commit()

    stream = TaskStream()
    _streams[task_id] = stream
    _running[task_id] = True
    _task_users[task_id] = user_id

    task = asyncio.create_task(
        _run_loop(
            task_id,
            messages,
            conversation_id,
            user_id,
            stream,
            trace,
            request_public_base_url=request_public_base_url,
        )
    )
    _task_handles[task_id] = task
    return task_id


async def spawn_diagnosis_task(
    payload: Dict[str, Any],
    *,
    user_id: Optional[int] = None,
) -> str:
    """Create a durable background diagnosis task.

    Unlike the legacy diagnosis SSE endpoint, this task is owned by the backend
    task registry. Closing/reloading the browser only drops the subscriber; the
    diagnosis coroutine keeps running and all progress/result events are flushed
    to the Task row for later replay.
    """
    if user_id is not None and _running_count_for_user(user_id) >= MAX_RUNNING_TASKS_PER_USER:
        raise RuntimeError(f"同一用户最多同时运行 {MAX_RUNNING_TASKS_PER_USER} 个后台任务")

    task_id = uuid.uuid4().hex[:16]
    trace_id = uuid.uuid4().hex[:12]
    article_id = payload.get("article_id")
    trace = _new_trace(task_id, trace_id, None, user_id)
    trace.update(
        {
            "task_type": "diagnosis",
            "article_id": article_id,
            "title": _truncate(payload.get("title") or "", 80),
            "current_step": "queued",
            "diagnosis_progress": [],
        }
    )

    async with SessionLocal() as s:
        t = Task(
            id=task_id,
            user_id=user_id,
            conversation_id=None,
            status="running",
            trace_id=trace_id,
            trace=trace,
        )
        s.add(t)
        await s.commit()

    stream = TaskStream()
    _streams[task_id] = stream
    _running[task_id] = True
    _task_users[task_id] = user_id

    task = asyncio.create_task(_run_diagnosis_loop(task_id, payload, user_id, stream, trace))
    _task_handles[task_id] = task
    return task_id


async def find_running_diagnosis_task(
    article_id: int,
    *,
    user_id: Optional[int] = None,
) -> Optional[Task]:
    """Return the newest running diagnosis task for an article, if any."""
    async with SessionLocal() as s:
        q = select(Task).where(Task.status == "running").order_by(Task.updated_at.desc())
        if user_id is not None:
            q = q.where(Task.user_id == user_id)
        res = await s.execute(q.limit(80))
        for task in res.scalars().all():
            trace = task.trace or {}
            if trace.get("task_type") == "diagnosis" and int(trace.get("article_id") or 0) == int(article_id):
                return task
    return None


async def _run_loop(
    task_id: str,
    messages: List[Dict[str, Any]],
    conversation_id: Optional[int],
    user_id: Optional[int],
    stream: TaskStream,
    trace: Dict[str, Any],
    *,
    request_public_base_url: str = "",
):
    """Execute the agent stream, pushing events to the broadcast stream."""
    from ..config import get_effective_settings, with_public_base_url_if_missing
    from ..services.llm import reset_current_settings, set_current_settings
    from .tools import reset_tool_user_id, set_tool_user_id

    settings = None
    if user_id:
        settings = await get_effective_settings(user_id)
    if settings and request_public_base_url:
        settings = with_public_base_url_if_missing(settings, request_public_base_url)
    if settings:
        trace["model"] = {
            "chat_model": settings.chat_model,
            "image_model": settings.image_model,
            "chat_model_candidates": settings.chat_model_candidates,
            "image_model_candidates": settings.image_model_candidates,
            "chat_base_url": settings.effective_chat_base_url,
            "image_base_url": settings.effective_image_base_url,
            "public_base_url": settings.public_base_url.rstrip("/"),
            "public_base_url_inferred": bool(request_public_base_url and settings.public_base_url.rstrip("/") == request_public_base_url.rstrip("/")),
        }

    runtime_messages = await _with_user_memory(user_id, messages)
    user_token = set_tool_user_id(user_id)
    settings_token = set_current_settings(settings)

    result_text = ""
    last_flush = time.time()
    status = "completed"
    started = time.perf_counter()
    first_event_ms: Optional[int] = None
    first_token_ms: Optional[int] = None
    tool_started_at: Dict[str, float] = {}

    try:
        async for ev in run_agent_stream(runtime_messages, settings=settings):
            if task_id in _cancelled:
                status = "cancelled"
                break

            now_perf = time.perf_counter()
            if first_event_ms is None:
                first_event_ms = int((now_perf - started) * 1000)
                trace.setdefault("timings_ms", {})["first_event"] = first_event_ms

            ev_type = ev.get("type", "unknown")
            _count_event(trace, ev_type)
            stream.push(ev)

            if ev.get("type") == "token":
                text = ev.get("text", "")
                if first_token_ms is None:
                    first_token_ms = int((now_perf - started) * 1000)
                    trace.setdefault("timings_ms", {})["first_token"] = first_token_ms
                result_text += text
                trace["token_chars"] = int(trace.get("token_chars", 0)) + len(text or "")
            elif ev.get("type") == "error":
                status = "failed"
                trace.setdefault("errors", []).append(_truncate(ev.get("message"), 500))
            elif ev.get("type") == "tool_call":
                tid = str(ev.get("id") or uuid.uuid4().hex[:8])
                tool_started_at[tid] = now_perf
                trace.setdefault("tools", []).append(
                    {
                        "id": tid,
                        "name": ev.get("name", "unknown"),
                        "started_ms": int((now_perf - started) * 1000),
                        "arguments_preview": _truncate(ev.get("arguments"), 500),
                    }
                )
            elif ev.get("type") == "tool_progress":
                tid = str(ev.get("id") or "")
                for item in reversed(trace.setdefault("tools", [])):
                    if item.get("id") == tid:
                        progress = item.setdefault("progress", [])
                        if len(progress) < 50:
                            progress.append(
                                {
                                    "step": ev.get("step", ""),
                                    "message": _truncate(ev.get("message"), 240),
                                    "at_ms": int((now_perf - started) * 1000),
                                }
                            )
                        break
            elif ev.get("type") == "tool_result":
                tid = str(ev.get("id") or "")
                elapsed = None
                if tid in tool_started_at:
                    elapsed = int((now_perf - tool_started_at.pop(tid)) * 1000)
                for item in reversed(trace.setdefault("tools", [])):
                    if item.get("id") == tid:
                        result = ev.get("result")
                        item["elapsed_ms"] = elapsed
                        item["ok"] = bool(result.get("ok", True)) if isinstance(result, dict) else True
                        item["result_preview"] = _truncate(result, 500)
                        break

            now = time.time()
            if now - last_flush > TRACE_FLUSH_INTERVAL_SECONDS:
                last_flush = now
                trace.setdefault("timings_ms", {})["elapsed"] = int((time.perf_counter() - started) * 1000)
                await _flush_events(task_id, stream.events, result_text, trace)
    except asyncio.CancelledError:
        status = "cancelled"
        _cancelled.add(task_id)
    except Exception as e:
        stream.push({"type": "error", "message": str(e)})
        status = "failed"
        trace.setdefault("errors", []).append(_truncate(str(e), 500))
    finally:
        reset_current_settings(settings_token)
        reset_tool_user_id(user_token)

        trace["status"] = status
        trace["completed_at"] = _now_iso()
        trace.setdefault("timings_ms", {})["elapsed"] = int((time.perf_counter() - started) * 1000)

        if status == "cancelled" and not stream.done:
            stream.push({"type": "cancelled", "text": result_text})
        elif not stream.done:
            stream.push({"type": "done", "text": result_text})

        try:
            await _finalize_task(task_id, conversation_id, stream.events, result_text, status, trace)
            if status == "completed":
                await _update_user_memory(user_id, messages, result_text)
        except Exception:
            pass

        _running.pop(task_id, None)
        _task_handles.pop(task_id, None)
        _task_users.pop(task_id, None)
        _cancelled.discard(task_id)
        await asyncio.sleep(STREAM_RETENTION_SECONDS)
        _streams.pop(task_id, None)


async def _run_diagnosis_loop(
    task_id: str,
    payload: Dict[str, Any],
    user_id: Optional[int],
    stream: TaskStream,
    trace: Dict[str, Any],
):
    """Execute diagnosis in the same durable task infrastructure as Agent runs."""
    from ..config import get_effective_settings
    from .diagnosis import run_diagnosis
    from .tools import _diagnosis_result_payload, _save_diagnosis_report

    status = "completed"
    result_text = ""
    started = time.perf_counter()
    last_flush = time.time()
    settings = await get_effective_settings(user_id) if user_id else None
    if settings:
        trace["model"] = {
            "chat_model": settings.chat_model,
            "image_model": settings.image_model,
            "chat_model_candidates": settings.chat_model_candidates,
            "image_model_candidates": settings.image_model_candidates,
            "chat_base_url": settings.effective_chat_base_url,
            "image_base_url": settings.effective_image_base_url,
        }

    article_id = int(payload.get("article_id") or 0)
    image_context = payload.get("image_context") if isinstance(payload.get("image_context"), dict) else {}

    async def push_event(ev: Dict[str, Any], *, force_flush: bool = False) -> None:
        nonlocal last_flush, result_text
        now_perf = time.perf_counter()
        ev = dict(ev)
        ev_type = str(ev.get("type") or "unknown")
        _count_event(trace, ev_type)
        if ev_type == "progress":
            trace["current_step"] = ev.get("step") or trace.get("current_step") or ""
            progress = trace.setdefault("diagnosis_progress", [])
            if len(progress) < 80:
                progress.append(
                    {
                        "step": ev.get("step", ""),
                        "message": _truncate(ev.get("message"), 240),
                        "at_ms": int((now_perf - started) * 1000),
                    }
                )
        elif ev_type == "result":
            data = ev.get("data") if isinstance(ev.get("data"), dict) else {}
            result_text = f"诊断完成：{data.get('grade', '-') }级 · {data.get('overall_score', 0)}分"
            trace["diagnosis_result"] = {
                "diagnosis_id": data.get("diagnosis_id") or data.get("id"),
                "overall_score": data.get("overall_score"),
                "grade": data.get("grade"),
                "article_id": data.get("article_id") or article_id,
            }
        elif ev_type == "error":
            trace.setdefault("errors", []).append(_truncate(ev.get("message"), 500))
            result_text = _truncate(ev.get("message"), 1000)
        stream.push(ev)
        trace.setdefault("timings_ms", {})["elapsed"] = int((now_perf - started) * 1000)
        now = time.time()
        if force_flush or now - last_flush > TRACE_FLUSH_INTERVAL_SECONDS:
            last_flush = now
            await _flush_events(task_id, stream.events, result_text, trace)

    async def progress_callback(step: str, message: str, data: Optional[Dict[str, Any]] = None):
        await push_event({"type": "progress", "step": step, "message": message, "data": data})

    try:
        await push_event(
            {
                "type": "progress",
                "step": "queued",
                "message": "诊断任务已进入后台队列，可关闭或刷新页面",
                "data": {"article_id": article_id, "background": True},
            },
            force_flush=True,
        )
        result = await run_diagnosis(
            title=str(payload.get("title") or ""),
            content=str(payload.get("content") or ""),
            tags=list(payload.get("tags") or []),
            image_count=int(payload.get("image_count") or 0),
            images=list(payload.get("images") or []),
            cover_image=str(payload.get("cover_image") or ""),
            progress=progress_callback,
            settings=settings,
        )
        report = _diagnosis_result_payload(result, article_id, image_context=image_context)
        if article_id:
            report = await _save_diagnosis_report(article_id, report, user_id=user_id)
        await push_event({"type": "result", "data": report}, force_flush=True)
    except asyncio.CancelledError:
        status = "cancelled"
        _cancelled.add(task_id)
    except Exception as e:
        status = "failed"
        await push_event({"type": "error", "message": f"诊断失败: {e}"}, force_flush=True)
    finally:
        trace["status"] = status
        trace["completed_at"] = _now_iso()
        trace.setdefault("timings_ms", {})["elapsed"] = int((time.perf_counter() - started) * 1000)
        if status == "cancelled" and not stream.done:
            stream.push({"type": "cancelled", "text": result_text})
        elif not stream.done:
            stream.push({"type": "done", "text": result_text})

        try:
            await _finalize_task(task_id, None, stream.events, result_text, status, trace)
        except Exception:
            pass

        _running.pop(task_id, None)
        _task_handles.pop(task_id, None)
        _task_users.pop(task_id, None)
        _cancelled.discard(task_id)
        await asyncio.sleep(STREAM_RETENTION_SECONDS)
        _streams.pop(task_id, None)


async def _flush_events(
    task_id: str,
    events: List[Dict[str, Any]],
    result_text: str,
    trace: Optional[Dict[str, Any]] = None,
):
    try:
        async with SessionLocal() as s:
            t = await s.get(Task, task_id)
            if t:
                t.events = list(events)
                t.result_text = result_text
                if trace is not None:
                    t.trace = dict(trace)
                await s.commit()
    except Exception:
        pass


async def _finalize_task(
    task_id: str,
    conversation_id: Optional[int],
    events: List[Dict[str, Any]],
    result_text: str,
    status: str,
    trace: Dict[str, Any],
):
    """Mark task complete and write final assistant message to conversation."""
    try:
        async with SessionLocal() as s:
            t = await s.get(Task, task_id)
            if t:
                t.status = status
                t.events = list(events)
                t.result_text = result_text
                t.trace = dict(trace)

            if conversation_id:
                conv = await s.get(Conversation, conversation_id)
                if conv:
                    conv.active_task_id = None
                    bound_article_id = _latest_bound_article_id(events)
                    if bound_article_id:
                        conv.article_id = bound_article_id
                    msgs = list(conv.messages or [])
                    if msgs and msgs[-1].get("role") == "assistant":
                        msgs[-1]["content"] = result_text
                        tool_events = []
                        for ev in events:
                            if ev.get("type") in ("tool_call", "tool_progress", "tool_result"):
                                tool_events.append(ev)
                        if tool_events:
                            msgs[-1]["tool_events"] = tool_events
                    conv.messages = msgs
            await s.commit()
    except Exception:
        pass


async def _with_user_memory(
    user_id: Optional[int],
    messages: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Inject a compact user-memory system message without persisting it to chat history."""
    if user_id is None:
        return messages
    try:
        async with SessionLocal() as s:
            res = await s.execute(select(UserMemory).where(UserMemory.user_id == user_id))
            mem = res.scalars().first()
        if not mem:
            return messages
        parts: List[str] = []
        if mem.summary:
            parts.append(f"长期偏好摘要：{_truncate(mem.summary, 900)}")
        profile = mem.profile or {}
        if profile:
            compact_profile = {k: v for k, v in profile.items() if v}
            if compact_profile:
                parts.append(f"偏好画像：{compact_profile}")
        recent = (mem.recent_briefs or [])[-5:]
        if recent:
            lines = []
            for item in recent:
                content = _truncate(item.get("content", ""), 120)
                if content:
                    lines.append(f"- {content}")
            if lines:
                parts.append("最近创作需求：\n" + "\n".join(lines))
        if not parts:
            return messages
        memory_prompt = (
            "以下是该用户的长期创作上下文。用于保持风格连续性，但如果与本轮明确要求冲突，"
            "以本轮要求为准。\n" + "\n\n".join(parts)
        )
        return [{"role": "system", "content": memory_prompt}] + messages
    except Exception:
        return messages


def _last_user_content(messages: List[Dict[str, Any]]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user":
            return _truncate(msg.get("content", ""), 600)
    return ""


def _infer_profile_hint(content: str) -> Dict[str, Any]:
    """Small deterministic preference extractor; avoids extra model calls."""
    hints: Dict[str, Any] = {}
    text = content or ""
    if any(x in text for x in ("小红书", "种草", "爆款")):
        hints["platform"] = "小红书"
    for tone in ("治愈", "专业", "口语", "高级", "活泼", "犀利", "干货", "情绪"):
        if tone in text:
            hints.setdefault("tones", [])
            if tone not in hints["tones"]:
                hints["tones"].append(tone)
    for audience in ("打工人", "宝妈", "学生", "新手", "女生", "职场", "创业者"):
        if audience in text:
            hints.setdefault("audiences", [])
            if audience not in hints["audiences"]:
                hints["audiences"].append(audience)
    return hints


def _merge_profile(old: Dict[str, Any], hints: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(old or {})
    for key, value in hints.items():
        if isinstance(value, list):
            existing = list(merged.get(key) or [])
            for item in value:
                if item not in existing:
                    existing.append(item)
            merged[key] = existing[-12:]
        elif value:
            merged[key] = value
    return merged


def _build_memory_summary(recent: List[Dict[str, Any]], profile: Dict[str, Any]) -> str:
    lines: List[str] = []
    if profile.get("platform"):
        lines.append(f"主要平台：{profile['platform']}")
    if profile.get("tones"):
        lines.append("偏好语气：" + "、".join(profile["tones"][-8:]))
    if profile.get("audiences"):
        lines.append("常见受众：" + "、".join(profile["audiences"][-8:]))
    briefs = [_truncate(x.get("content", ""), 80) for x in recent[-5:] if x.get("content")]
    if briefs:
        lines.append("近期主题：" + " / ".join(briefs))
    return _truncate("\n".join(lines), 1200)


async def _update_user_memory(
    user_id: Optional[int],
    messages: List[Dict[str, Any]],
    result_text: str,
) -> None:
    if user_id is None:
        return
    content = _last_user_content(messages)
    if not content:
        return
    try:
        async with SessionLocal() as s:
            res = await s.execute(select(UserMemory).where(UserMemory.user_id == user_id))
            mem = res.scalars().first()
            if not mem:
                mem = UserMemory(user_id=user_id)
                s.add(mem)
            recent = list(mem.recent_briefs or [])
            recent.append(
                {
                    "content": content,
                    "result_preview": _truncate(result_text, 160),
                    "at": _now_iso(),
                }
            )
            recent = recent[-MAX_MEMORY_BRIEFS:]
            profile = _merge_profile(mem.profile or {}, _infer_profile_hint(content))
            mem.recent_briefs = recent
            mem.profile = profile
            mem.summary = _build_memory_summary(recent, profile)
            await s.commit()
    except Exception:
        pass


def get_stream(task_id: str) -> Optional[TaskStream]:
    return _streams.get(task_id)


def is_running(task_id: str) -> bool:
    return _running.get(task_id, False)


async def cancel_task(task_id: str, user_id: Optional[int] = None) -> bool:
    """Cancel a running background agent task owned by user_id."""
    async with SessionLocal() as s:
        t = await s.get(Task, task_id)
        if not t:
            return False
        if user_id is not None and t.user_id is not None and t.user_id != user_id:
            return False
        t.status = "cancelled"
        await s.commit()

    _cancelled.add(task_id)
    stream = _streams.get(task_id)
    if stream and not stream.done:
        stream.push({"type": "cancelled", "text": ""})
    handle = _task_handles.get(task_id)
    if handle and not handle.done():
        handle.cancel()
    _running.pop(task_id, None)
    return True
