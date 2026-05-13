"""诊断 SSE 流式 API：/api/diagnose/stream"""
from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..config import get_effective_settings
from ..database import Article, SessionLocal, User
from ..agents.diagnosis import run_diagnosis
from ..agents.tools import _article_image_context

router = APIRouter()


class DiagnoseStreamRequest(BaseModel):
    article_id: Optional[int] = None
    title: str = ""
    content: str = ""
    tags: List[str] = Field(default_factory=list)
    image_count: int = 0
    images: List[str] = Field(default_factory=list)


@router.post("/diagnose/stream")
async def diagnose_stream(req: DiagnoseStreamRequest, user: User = Depends(get_current_user)):
    title = req.title
    content = req.content
    tags = req.tags
    image_count = req.image_count
    images = req.images
    cover_image = ""

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
            image_ctx = _article_image_context(article)
            cover_image = str(image_ctx.get("cover_image") or "")
            images = [x["url"] for x in image_ctx.get("visual_images", []) if x.get("url")]
            image_count = len(images)

    if not title and not content:
        raise HTTPException(400, "标题和正文不能同时为空")

    progress_queue: asyncio.Queue = asyncio.Queue()
    effective_settings = await get_effective_settings(user.id)

    async def progress_callback(step: str, message: str, data: Optional[Dict[str, Any]] = None):
        await progress_queue.put({"type": "progress", "step": step, "message": message, "data": data})

    async def run_task():
        try:
            result = await run_diagnosis(
                title=title,
                content=content,
                tags=tags,
                image_count=image_count,
                images=images,
                cover_image=cover_image,
                progress=progress_callback,
                settings=effective_settings,
            )
            await progress_queue.put({"type": "result", "data": {
                "overall_score": result.overall_score,
                "grade": result.grade,
                "radar_data": result.radar_data,
                "issues": result.issues,
                "suggestions": result.suggestions,
                "debate_summary": result.debate_summary,
                "optimized_title": result.optimized_title,
                "optimized_content": result.optimized_content,
                "optimized_tags": result.optimized_tags,
                "cover_direction": result.cover_direction,
                "simulated_comments": result.simulated_comments,
                "agent_opinions": result.agent_opinions,
                "debate_results": result.debate_results,
                "model_a_score": result.model_a_score,
                "text_analysis": result.text_analysis,
                "category": result.category,
                "category_cn": result.category_cn,
                "elapsed_ms": result.elapsed_ms,
            }})
        except Exception as e:
            await progress_queue.put({"type": "error", "message": f"诊断失败: {e}"})
        finally:
            await progress_queue.put(None)

    async def event_gen():
        task = asyncio.create_task(run_task())
        try:
            while True:
                item = await asyncio.wait_for(progress_queue.get(), timeout=480)
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type': 'error', 'message': '诊断超时'}, ensure_ascii=False)}\n\n"
        finally:
            if not task.done():
                task.cancel()
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")
