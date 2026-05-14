"""诊断后台任务 API：/api/diagnose/stream / start / active."""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..database import Article, SessionLocal, User
from ..agents.tools import _article_image_context
from ..agents.background import find_running_diagnosis_task, get_stream, spawn_diagnosis_task

router = APIRouter()


class DiagnoseStreamRequest(BaseModel):
    article_id: Optional[int] = None
    title: str = ""
    content: str = ""
    tags: List[str] = Field(default_factory=list)
    image_count: int = 0
    images: List[str] = Field(default_factory=list)


async def _build_diagnosis_payload(req: DiagnoseStreamRequest, user: User) -> Dict[str, Any]:
    title = req.title
    content = req.content
    tags = req.tags
    image_count = req.image_count
    images = req.images
    cover_image = ""
    image_context: Dict[str, Any] = {}

    if req.article_id:
        async with SessionLocal() as s:
            article = await s.get(Article, req.article_id)
            if not article:
                raise HTTPException(404, "笔记不存在")
            if article.user_id != user.id:
                raise HTTPException(403, "无权访问该笔记")
            title = article.title or ""
            content = article.body or ""
            tags = [t for t in (article.tags or "").split(",") if t.strip()]
            image_context = _article_image_context(article)
            cover_image = str(image_context.get("cover_image_full_url") or image_context.get("cover_image") or "")
            images = [
                str(x.get("model_url") or x.get("full_url") or x.get("url"))
                for x in image_context.get("visual_images", [])
                if x.get("url")
            ]
            image_count = len(images)

    if not title and not content:
        raise HTTPException(400, "标题和正文不能同时为空")

    return {
        "article_id": int(req.article_id or 0),
        "title": title,
        "content": content,
        "tags": tags,
        "image_count": image_count,
        "images": images,
        "cover_image": cover_image,
        "image_context": image_context,
    }


@router.post("/diagnose/start")
async def diagnose_start(req: DiagnoseStreamRequest, user: User = Depends(get_current_user)):
    """Start a durable background diagnosis task without requiring an open SSE tab."""
    payload = await _build_diagnosis_payload(req, user)
    try:
        task_id = await spawn_diagnosis_task(payload, user_id=user.id)
    except RuntimeError as e:
        raise HTTPException(429, str(e))
    return {"ok": True, "task_id": task_id, "article_id": payload.get("article_id")}


@router.get("/diagnose/active")
async def active_diagnosis_task(article_id: int, user: User = Depends(get_current_user)):
    """Return the newest running diagnosis task for this article, if present."""
    task = await find_running_diagnosis_task(article_id, user_id=user.id)
    return {"task": task.to_dict() if task else None}


@router.post("/diagnose/stream")
async def diagnose_stream(req: DiagnoseStreamRequest, user: User = Depends(get_current_user)):
    """Start diagnosis as a backend task and subscribe to its event stream.

    Browser refresh/close only disconnects this SSE subscription; the spawned
    backend task continues and can be resumed via /api/tasks/{task_id}/stream.
    """
    payload = await _build_diagnosis_payload(req, user)
    try:
        task_id = await spawn_diagnosis_task(payload, user_id=user.id)
    except RuntimeError as e:
        raise HTTPException(429, str(e))

    async def event_gen():
        yield f"data: {json.dumps({'type': 'task_id', 'task_id': task_id}, ensure_ascii=False)}\n\n"
        stream = get_stream(task_id)
        if not stream:
            yield f"data: {json.dumps({'type': 'error', 'message': '诊断任务流不存在'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return
        async for item in stream.subscribe(from_index=0):
            yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")
