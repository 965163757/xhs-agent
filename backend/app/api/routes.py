from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select

from ..agents.background import cancel_task, get_stream, is_running, spawn_agent_task
from ..agents.runner import run_agent_stream
from ..agents.tools import TOOLS, call_tool_for_user, openai_tool_schemas
from ..auth import get_current_user, require_admin
from ..config import get_settings, update_settings
from ..database import Article, ArticleVersion, Conversation, SessionLocal, Task, Template, User
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
    ExtractTemplateRequest,
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
    TemplateCreate,
)
from ..services.llm import generate_image

router = APIRouter()


async def _call_user_tool(name: str, arguments: Dict[str, Any], user: User) -> Dict[str, Any]:
    """Call a registered tool with the authenticated user's context/settings."""
    try:
        return await call_tool_for_user(name, arguments, user.id)
    except Exception as e:
        return {"ok": False, "error": str(e), "tool": name}


# ---------- chat ----------

@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user: User = Depends(get_current_user)):
    if req.conversation_id:
        async with SessionLocal() as s:
            conv = await s.get(Conversation, req.conversation_id)
            if not conv or conv.user_id != user.id:
                raise HTTPException(404, "conversation not found")

    messages: List[Dict[str, Any]] = []
    for m in req.messages:
        messages.append(
            {"role": m.role, "content": m.content, "images": m.images}
        )

    task_id = await spawn_agent_task(messages, conversation_id=req.conversation_id, user_id=user.id)

    async def event_gen():
        stream = get_stream(task_id)
        if not stream:
            yield f"data: {json.dumps({'type':'error','message':'task not found'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # First event: tell client the task_id
        yield f"data: {json.dumps({'type':'task_id','task_id': task_id}, ensure_ascii=False)}\n\n"

        try:
            async for ev in stream.subscribe(from_index=0):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type':'error','message':'timeout'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")


# ---------- articles CRUD ----------

@router.get("/articles")
async def list_articles(limit: int = 50, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        res = await s.execute(
            select(Article)
            .where(Article.user_id == user.id)
            .order_by(Article.updated_at.desc())
            .limit(limit)
        )
        return {"items": [a.to_dict() for a in res.scalars().all()]}


@router.get("/articles/{aid}")
async def get_article(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "not found")
        return a.to_dict()


@router.post("/articles")
async def create_article(payload: ArticleIn, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = Article(
            user_id=user.id,
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
async def update_article(aid: int, payload: ArticleUpdate, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
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
async def delete_article(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "not found")
        await s.delete(a)
        await s.commit()
        return {"ok": True}


# ---------- higher-level actions ----------

@router.post("/articles/generate")
async def api_generate(payload: GenerateArticleRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("generate_article", payload.model_dump(), user)


@router.post("/articles/rewrite")
async def api_rewrite(payload: RewriteRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("rewrite_article", payload.model_dump(), user)


@router.post("/articles/optimize")
async def api_optimize(payload: OptimizeRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("optimize_article", payload.model_dump(), user)


@router.post("/articles/score")
async def api_score(payload: ScoreRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("score_article", payload.model_dump(), user)


@router.post("/articles/diagnose")
async def api_diagnose(payload: DiagnoseRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("diagnose_article", payload.model_dump(), user)


@router.post("/articles/outline")
async def api_outline(payload: OutlineRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("outline_article", payload.model_dump(), user)


@router.post("/articles/suggest_tags")
async def api_suggest_tags_post(payload: SuggestTagsRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("suggest_tags", payload.model_dump(), user)


@router.post("/articles/suggest_titles")
async def api_suggest_titles(payload: SuggestTitlesRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("suggest_titles", payload.model_dump(), user)


@router.post("/articles/polish")
async def api_polish(payload: PolishRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("polish_paragraph", payload.model_dump(), user)


@router.post("/articles/cover_prompt")
async def api_cover_prompt(payload: CoverPromptRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("cover_prompt", payload.model_dump(), user)


@router.post("/articles/content_image_prompt")
async def api_content_image_prompt(payload: ContentImagePromptRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("content_image_prompt", payload.model_dump(), user)


@router.post("/articles/remove_image")
async def api_remove_image(payload: RemoveImageRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("remove_image", payload.model_dump(), user)


# ---------- image editing ----------

@router.post("/images/crop")
async def api_crop(payload: CropImageRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("crop_image", payload.model_dump(), user)


@router.post("/images/inpaint")
async def api_inpaint(payload: InpaintRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("inpaint_image", payload.model_dump(), user)


@router.post("/images/remove_object")
async def api_remove_object(payload: RemoveObjectRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("remove_object", payload.model_dump(), user)


@router.post("/images/edit")
async def api_edit_image(payload: EditImageRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("edit_image", payload.model_dump(), user)


@router.post("/images/upload_mask")
async def upload_mask(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    """Upload a PNG mask (transparent where the user wants to edit)."""
    import time, uuid
    settings = get_settings()
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix.lower() or ".png"
    if ext != ".png":
        raise HTTPException(400, "mask 必须是 PNG")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(413, "文件过大，最大 10MB")
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}_mask.png"
    (Path(settings.image_dir) / name).write_bytes(content)
    return {"url": f"/static/images/{name}"}


@router.post("/images/generate")
async def api_image(payload: ImageGenRequest, user: User = Depends(get_current_user)):
    from ..config import get_effective_settings
    effective = await get_effective_settings(user.id)
    urls = await generate_image(
        prompt=payload.prompt,
        size=payload.size,
        n=payload.n,
        reference_images=payload.reference_images,
        settings=effective,
    )
    return {"images": urls}


@router.post("/upload")
async def upload_image(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    import time, uuid
    ALLOWED_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    MAX_SIZE = 10 * 1024 * 1024
    settings = get_settings()
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "").suffix.lower() or ".png"
    if ext not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的文件类型: {ext}")
    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(413, "文件过大，最大 10MB")
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
    path = Path(settings.image_dir) / name
    path.write_bytes(content)
    return {"url": f"/static/images/{name}"}


# ---------- templates ----------

@router.get("/templates")
async def list_templates(user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        res = await s.execute(
            select(Template)
            .where(or_(Template.creator_id.is_(None), Template.creator_id == user.id))
            .order_by(Template.id.asc())
        )
        return {"items": [t.to_dict() for t in res.scalars().all()]}


@router.post("/templates/apply")
async def apply_template(payload: ApplyTemplateRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("apply_template", payload.model_dump(), user)


@router.post("/templates")
async def create_template(payload: TemplateCreate, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        t = Template(
            creator_id=user.id,
            name=payload.name,
            category=payload.category,
            description=payload.description,
            body=payload.body,
            tags=payload.tags,
        )
        s.add(t)
        await s.commit()
        await s.refresh(t)
        return t.to_dict()


@router.delete("/templates/{tid}")
async def delete_template(tid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        t = await s.get(Template, tid)
        if not t:
            raise HTTPException(404, "not found")
        if t.creator_id is not None and t.creator_id != user.id and user.role != "admin":
            raise HTTPException(403, "无权删除")
        await s.delete(t)
        await s.commit()
        return {"ok": True}


@router.post("/templates/extract")
async def extract_template(payload: ExtractTemplateRequest, user: User = Depends(get_current_user)):
    """Use LLM to extract a reusable template structure from an existing article."""
    from ..config import get_effective_settings
    from ..services.llm import chat_completion
    effective = await get_effective_settings(user.id)
    async with SessionLocal() as s:
        art = await s.get(Article, payload.article_id)
        if not art or art.user_id != user.id:
            raise HTTPException(404, "article not found")
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书模板提取专家。分析给定笔记的结构，提取出可复用的模板骨架。\n"
                    "模板应该抽象掉具体内容，保留结构框架和写作指导。\n"
                    "严格按 JSON 返回：\n"
                    '{"name":"模板名称","category":"分类","description":"一句话描述适用场景",'
                    '"body":"模板骨架（用 [占位符] 标注可替换部分）","tags":["#标签模板"]}'
                ),
            },
            {
                "role": "user",
                "content": f"标题：{art.title}\n正文：\n{art.body}\n标签：{art.tags}",
            },
        ],
        temperature=0.5,
        settings=effective,
    )
    from ..agents.tools import _safe_json
    data = _safe_json(resp.choices[0].message.content or "")
    template = Template(
        name=data.get("name", f"从笔记#{art.id}提取"),
        category=data.get("category", "自定义"),
        description=data.get("description", ""),
        body=data.get("body", ""),
        tags=data.get("tags", []),
        creator_id=user.id,
    )
    async with SessionLocal() as s:
        s.add(template)
        await s.commit()
        await s.refresh(template)
        return template.to_dict()


# ---------- conversations ----------

@router.get("/conversations")
async def list_conversations(user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        res = await s.execute(
            select(Conversation)
            .where(Conversation.user_id == user.id)
            .order_by(Conversation.updated_at.desc())
            .limit(100)
        )
        return {"items": [c.to_dict() for c in res.scalars().all()]}


@router.get("/conversations/{cid}")
async def get_conversation(cid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or c.user_id != user.id:
            raise HTTPException(404, "not found")
        return c.to_dict()


@router.post("/conversations")
async def create_conversation(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        article_id = payload.get("article_id")
        if article_id:
            a = await s.get(Article, int(article_id))
            if not a or a.user_id != user.id:
                raise HTTPException(404, "article not found")
        c = Conversation(
            user_id=user.id,
            title=payload.get("title", "新对话"),
            article_id=article_id,
            messages=payload.get("messages", []),
        )
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.to_dict()


@router.patch("/conversations/{cid}")
async def update_conversation(cid: int, payload: Dict[str, Any], user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or c.user_id != user.id:
            raise HTTPException(404, "not found")
        if "article_id" in payload and payload["article_id"]:
            a = await s.get(Article, int(payload["article_id"]))
            if not a or a.user_id != user.id:
                raise HTTPException(404, "article not found")
        for k in ("title", "messages", "article_id"):
            if k in payload:
                setattr(c, k, payload[k])
        await s.commit()
        await s.refresh(c)
        return c.to_dict()


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or c.user_id != user.id:
            raise HTTPException(404, "not found")
        await s.delete(c)
        await s.commit()
        return {"ok": True}


# ---------- article versions ----------

@router.get("/articles/{aid}/versions")
async def list_versions(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "not found")
        res = await s.execute(
            select(ArticleVersion)
            .where(ArticleVersion.article_id == aid)
            .order_by(ArticleVersion.version.desc())
        )
        return {"items": [v.to_dict() for v in res.scalars().all()]}


@router.post("/articles/{aid}/versions")
async def create_version(aid: int, payload: Dict[str, Any] = {}, user: User = Depends(get_current_user)):
    """Snapshot current article state as a new version."""
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        last = await s.execute(
            select(ArticleVersion)
            .where(ArticleVersion.article_id == aid)
            .order_by(ArticleVersion.version.desc())
            .limit(1)
        )
        last_v = last.scalars().first()
        next_ver = (last_v.version + 1) if last_v else 1
        v = ArticleVersion(
            article_id=aid,
            user_id=user.id,
            version=next_ver,
            title=a.title,
            body=a.body,
            tags=a.tags,
            cover_image=a.cover_image,
            images=a.images or [],
            trigger=payload.get("trigger", "manual"),
        )
        s.add(v)
        await s.commit()
        await s.refresh(v)
        return v.to_dict()


@router.post("/articles/{aid}/versions/{vid}/rollback")
async def rollback_version(aid: int, vid: int, user: User = Depends(get_current_user)):
    """Rollback article to a specific version."""
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        v = await s.get(ArticleVersion, vid)
        if not v or v.article_id != aid:
            raise HTTPException(404, "version not found")
        a.title = v.title
        a.body = v.body
        a.tags = v.tags
        a.cover_image = v.cover_image
        a.images = v.images or []
        await s.commit()
        await s.refresh(a)
        return a.to_dict()


# ---------- tasks ----------

@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        t = await s.get(Task, task_id)
        if not t or (t.user_id is not None and t.user_id != user.id):
            raise HTTPException(404, "task not found")
        return t.to_dict()


@router.get("/tasks/{task_id}/stream")
async def stream_task(task_id: str, from_index: int = 0, user: User = Depends(get_current_user)):
    """Reconnect to a running task's event stream."""
    async with SessionLocal() as s:
        t = await s.get(Task, task_id)
        if not t or (t.user_id is not None and t.user_id != user.id):
            raise HTTPException(404, "task not found")

    async def event_gen():
        if not is_running(task_id):
            async with SessionLocal() as s:
                t = await s.get(Task, task_id)
            if t and t.status != "running":
                ev_type = "cancelled" if t.status == "cancelled" else "done"
                yield f"data: {json.dumps({'type': ev_type, 'text': t.result_text or ''}, ensure_ascii=False)}\n\n"
            else:
                yield f"data: {json.dumps({'type':'error','message':'task not found or already finished'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        stream = get_stream(task_id)
        if not stream:
            yield f"data: {json.dumps({'type':'error','message':'task stream not available'}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
            return

        # Subscribe from current position (skip already-consumed events)
        try:
            async for ev in stream.subscribe(from_index=max(0, from_index)):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'type':'error','message':'timeout'}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream")


@router.post("/tasks/{task_id}/cancel")
async def cancel_running_task(task_id: str, user: User = Depends(get_current_user)):
    ok = await cancel_task(task_id, user_id=user.id)
    if not ok:
        raise HTTPException(404, "task not found")
    return {"ok": True}


# ---------- settings ----------

@router.get("/settings")
async def get_public_settings(user: User = Depends(get_current_user)):
    return get_settings().public_dict()


@router.put("/settings")
async def put_settings(payload: SettingsUpdate, user: User = Depends(require_admin)):
    new = update_settings(payload.model_dump(exclude_unset=True))
    return new.public_dict()


@router.post("/settings/test")
async def test_settings(user: User = Depends(get_current_user)):
    """Quick connectivity test against the currently saved config."""
    from ..services.llm import chat_completion
    from ..config import get_effective_settings
    effective = await get_effective_settings(user.id)
    try:
        r = await chat_completion(
            messages=[{"role": "user", "content": "Say ok"}],
            temperature=0.0,
            settings=effective,
        )
        content = r.choices[0].message.content or ""
        return {"ok": True, "reply": content[:80]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------- stats ----------

@router.get("/stats")
async def api_stats(user: User = Depends(get_current_user)):
    return await _call_user_tool("article_stats", {}, user)


@router.get("/stats/calendar")
async def api_calendar(user: User = Depends(get_current_user)):
    """Return articles grouped by creation date for calendar view."""
    async with SessionLocal() as s:
        res = await s.execute(
            select(Article)
            .where(Article.user_id == user.id)
            .order_by(Article.created_at.desc())
            .limit(200)
        )
        articles = res.scalars().all()
    calendar: Dict[str, List[Dict[str, Any]]] = {}
    for a in articles:
        day = a.created_at.strftime("%Y-%m-%d") if a.created_at else "unknown"
        if day not in calendar:
            calendar[day] = []
        calendar[day].append({"id": a.id, "title": a.title, "status": a.status})
    return {"calendar": calendar}


# ---------- meta ----------

@router.get("/meta")
async def meta(user: User = Depends(get_current_user)):
    from ..config import get_effective_settings
    s = await get_effective_settings(user.id)
    return {
        "chat_model": s.chat_model,
        "image_model": s.image_model,
        "base_url": s.openai_base_url,
    }


# ---------- banned words ----------

@router.post("/check_banned_words")
async def api_check_banned_words(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    from ..agents.banned_words import check_banned_words
    text = payload.get("text", "")
    result = check_banned_words(text)
    return result.to_dict()


@router.get("/banned_words")
async def api_get_banned_words(user: User = Depends(get_current_user)):
    from ..agents.banned_words import get_all_banned_words
    return get_all_banned_words()


# ---------- hot tags ----------

@router.get("/tags/suggest")
async def api_suggest_tags_get(query: str = "", category: str = "", limit: int = 20, user: User = Depends(get_current_user)):
    from ..agents.hot_tags import suggest_tags
    return {"items": suggest_tags(query=query, category=category, limit=limit)}


# ---------- MCP HTTP bridge (embedded server) ----------

@router.get("/mcp/tools")
async def mcp_list_tools(user: User = Depends(get_current_user)):
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
async def mcp_call(payload: MCPCallRequest, user: User = Depends(get_current_user)):
    if payload.name not in TOOLS:
        raise HTTPException(404, f"unknown tool: {payload.name}")
    result = await _call_user_tool(payload.name, payload.arguments or {}, user)
    return {"ok": True, "result": result}


@router.get("/tools")
async def tools_openai_schema(user: User = Depends(get_current_user)):
    """OpenAI function-calling schemas for any external agent that wants to drive the same tools."""
    return {"tools": openai_tool_schemas()}
