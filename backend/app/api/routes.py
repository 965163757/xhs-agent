from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from ..agents.runner import run_agent_stream
from ..agents.tools import TOOLS, call_tool, openai_tool_schemas
from ..config import get_settings, update_settings
from ..database import Article, Conversation, SessionLocal, Template
from ..schemas import (
    ApplyTemplateRequest,
    ArticleIn,
    ArticleUpdate,
    ChatRequest,
    ContentImagePromptRequest,
    CoverPromptRequest,
    CropImageRequest,
    DiagnoseRequest,
    EditImageRequest,
    GenerateArticleRequest,
    ImageGenRequest,
    InpaintRequest,
    MCPCallRequest,
    OptimizeRequest,
    OutlineRequest,
    PolishRequest,
    RemoveImageRequest,
    RemoveObjectRequest,
    RewriteRequest,
    ScoreRequest,
    SettingsUpdate,
    SuggestTagsRequest,
    SuggestTitlesRequest,
)
from ..services.llm import generate_image

router = APIRouter()


# ---------- chat ----------

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    async def event_gen():
        messages: List[Dict[str, Any]] = []
        for m in req.messages:
            messages.append(
                {"role": m.role, "content": m.content, "images": m.images}
            )
        try:
            async for ev in run_agent_stream(messages):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type':'error','message':str(e)}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# ---------- articles CRUD ----------

@router.get("/articles")
async def list_articles(limit: int = 50):
    async with SessionLocal() as s:
        res = await s.execute(
            select(Article).order_by(Article.updated_at.desc()).limit(limit)
        )
        return {"items": [a.to_dict() for a in res.scalars().all()]}


@router.get("/articles/{aid}")
async def get_article(aid: int):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a:
            raise HTTPException(404, "not found")
        return a.to_dict()


@router.post("/articles")
async def create_article(payload: ArticleIn):
    async with SessionLocal() as s:
        a = Article(
            title=payload.title,
            body=payload.body,
            tags=",".join(payload.tags),
            cover_image=payload.cover_image,
            images=payload.images,
            status=payload.status,
        )
        s.add(a)
        await s.commit()
        await s.refresh(a)
        return a.to_dict()


@router.patch("/articles/{aid}")
async def update_article(aid: int, payload: ArticleUpdate):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a:
            raise HTTPException(404, "not found")
        data = payload.model_dump(exclude_unset=True)
        if "tags" in data and data["tags"] is not None:
            a.tags = ",".join(data["tags"])
            data.pop("tags")
        for k, v in data.items():
            setattr(a, k, v)
        await s.commit()
        await s.refresh(a)
        return a.to_dict()


@router.delete("/articles/{aid}")
async def delete_article(aid: int):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a:
            raise HTTPException(404, "not found")
        await s.delete(a)
        await s.commit()
        return {"ok": True}


# ---------- higher-level actions ----------

@router.post("/articles/generate")
async def api_generate(payload: GenerateArticleRequest):
    return await call_tool("generate_article", payload.model_dump())


@router.post("/articles/rewrite")
async def api_rewrite(payload: RewriteRequest):
    return await call_tool("rewrite_article", payload.model_dump())


@router.post("/articles/optimize")
async def api_optimize(payload: OptimizeRequest):
    return await call_tool("optimize_article", payload.model_dump())


@router.post("/articles/score")
async def api_score(payload: ScoreRequest):
    return await call_tool("score_article", payload.model_dump())


@router.post("/articles/diagnose")
async def api_diagnose(payload: DiagnoseRequest):
    return await call_tool("diagnose_article", payload.model_dump())


@router.post("/articles/outline")
async def api_outline(payload: OutlineRequest):
    return await call_tool("outline_article", payload.model_dump())


@router.post("/articles/suggest_tags")
async def api_suggest_tags(payload: SuggestTagsRequest):
    return await call_tool("suggest_tags", payload.model_dump())


@router.post("/articles/suggest_titles")
async def api_suggest_titles(payload: SuggestTitlesRequest):
    return await call_tool("suggest_titles", payload.model_dump())


@router.post("/articles/polish")
async def api_polish(payload: PolishRequest):
    return await call_tool("polish_paragraph", payload.model_dump())


@router.post("/articles/cover_prompt")
async def api_cover_prompt(payload: CoverPromptRequest):
    return await call_tool("cover_prompt", payload.model_dump())


@router.post("/articles/content_image_prompt")
async def api_content_image_prompt(payload: ContentImagePromptRequest):
    return await call_tool("content_image_prompt", payload.model_dump())


@router.post("/articles/remove_image")
async def api_remove_image(payload: RemoveImageRequest):
    return await call_tool("remove_image", payload.model_dump())


# ---------- image editing ----------

@router.post("/images/crop")
async def api_crop(payload: CropImageRequest):
    return await call_tool("crop_image", payload.model_dump())


@router.post("/images/inpaint")
async def api_inpaint(payload: InpaintRequest):
    return await call_tool("inpaint_image", payload.model_dump())


@router.post("/images/remove_object")
async def api_remove_object(payload: RemoveObjectRequest):
    return await call_tool("remove_object", payload.model_dump())


@router.post("/images/edit")
async def api_edit_image(payload: EditImageRequest):
    return await call_tool("edit_image", payload.model_dump())


@router.post("/images/upload_mask")
async def upload_mask(file: UploadFile = File(...)):
    """Upload a PNG mask (transparent where the user wants to edit)."""
    import time, uuid
    settings = get_settings()
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}_mask.png"
    (Path(settings.image_dir) / name).write_bytes(await file.read())
    return {"url": f"/static/images/{name}"}


@router.post("/images/generate")
async def api_image(payload: ImageGenRequest):
    urls = await generate_image(
        prompt=payload.prompt,
        size=payload.size,
        n=payload.n,
        reference_images=payload.reference_images,
    )
    return {"images": urls}


@router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    import time, uuid
    settings = get_settings()
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix or ".png"
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
    path = Path(settings.image_dir) / name
    content = await file.read()
    path.write_bytes(content)
    return {"url": f"/static/images/{name}"}


# ---------- templates ----------

@router.get("/templates")
async def list_templates():
    async with SessionLocal() as s:
        res = await s.execute(select(Template).order_by(Template.id.asc()))
        return {"items": [t.to_dict() for t in res.scalars().all()]}


@router.post("/templates/apply")
async def apply_template(payload: ApplyTemplateRequest):
    return await call_tool("apply_template", payload.model_dump())


# ---------- conversations ----------

@router.get("/conversations")
async def list_conversations():
    async with SessionLocal() as s:
        res = await s.execute(
            select(Conversation).order_by(Conversation.updated_at.desc()).limit(100)
        )
        return {"items": [c.to_dict() for c in res.scalars().all()]}


@router.post("/conversations")
async def create_conversation(payload: Dict[str, Any]):
    async with SessionLocal() as s:
        c = Conversation(
            title=payload.get("title", "新对话"),
            article_id=payload.get("article_id"),
            messages=payload.get("messages", []),
        )
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.to_dict()


@router.patch("/conversations/{cid}")
async def update_conversation(cid: int, payload: Dict[str, Any]):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c:
            raise HTTPException(404, "not found")
        for k in ("title", "messages", "article_id"):
            if k in payload:
                setattr(c, k, payload[k])
        await s.commit()
        await s.refresh(c)
        return c.to_dict()


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: int):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c:
            raise HTTPException(404, "not found")
        await s.delete(c)
        await s.commit()
        return {"ok": True}


# ---------- settings ----------

@router.get("/settings")
async def get_public_settings():
    return get_settings().public_dict()


@router.put("/settings")
async def put_settings(payload: SettingsUpdate):
    new = update_settings(payload.model_dump(exclude_unset=True))
    return new.public_dict()


@router.post("/settings/test")
async def test_settings():
    """Quick connectivity test against the currently saved config."""
    from ..services.llm import chat_completion
    try:
        r = await chat_completion(
            messages=[{"role": "user", "content": "Say ok"}],
            temperature=0.0,
        )
        content = r.choices[0].message.content or ""
        return {"ok": True, "reply": content[:80]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------- meta ----------

@router.get("/meta")
async def meta():
    s = get_settings()
    return {
        "chat_model": s.chat_model,
        "image_model": s.image_model,
        "base_url": s.openai_base_url,
    }


# ---------- MCP HTTP bridge (embedded server) ----------

@router.get("/mcp/tools")
async def mcp_list_tools():
    """Same tools as stdio server, exposed over HTTP."""
    return {
        "tools": [
            {
                "name": name,
                "description": entry["schema"]["function"].get("description", ""),
                "inputSchema": entry["schema"]["function"].get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            }
            for name, entry in TOOLS.items()
        ]
    }


@router.post("/mcp/call")
async def mcp_call(payload: MCPCallRequest):
    if payload.name not in TOOLS:
        raise HTTPException(404, f"unknown tool: {payload.name}")
    result = await call_tool(payload.name, payload.arguments or {})
    return {"ok": True, "result": result}


@router.get("/tools")
async def tools_openai_schema():
    """OpenAI function-calling schemas for any external agent that wants to drive the same tools."""
    return {"tools": openai_tool_schemas()}
