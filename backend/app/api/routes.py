from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path
import time
import uuid
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select

from ..agents.background import cancel_task, get_stream, is_running, spawn_agent_task
from ..agents.tools import (
    TOOLS,
    _article_payload,
    _image_retry_options,
    _score_for_article,
    call_tool_for_user,
    openai_tool_schemas,
)
from ..auth import get_current_user, require_admin
from ..config import get_settings, update_settings
from ..database import Article, ArticleDiagnosis, ArticleVersion, Conversation, SessionLocal, Task, Template, User, UserMemory
from ..schemas import (
    ApplyTemplateRequest,
    ApplyDiagnosisRequest,
    ArticleImageArrangeRequest,
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
    ImageSettingsTestRequest,
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
    StaticImagePublicTestRequest,
    SuggestTagsRequest,
    SuggestTitlesRequest,
    TemplateCreate,
)
from ..services.llm import generate_image
from ..time_utils import beijing_date_key, beijing_iso, beijing_now_naive

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
IMAGE_FORMAT_TO_EXT = {
    "PNG": ".png",
    "JPEG": ".jpg",
    "WEBP": ".webp",
    "GIF": ".gif",
}


async def _call_user_tool(name: str, arguments: Dict[str, Any], user: User) -> Dict[str, Any]:
    """Call a registered tool with the authenticated user's context/settings."""
    try:
        return await call_tool_for_user(name, arguments, user.id)
    except Exception as e:
        return {"ok": False, "error": str(e), "tool": name}


async def _read_upload_limited(file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES) -> bytes:
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise HTTPException(413, f"文件过大，最大 {max_bytes // 1024 // 1024}MB")
    if not content:
        raise HTTPException(400, "文件为空")
    return content


def _inspect_image(
    content: bytes,
    *,
    allowed_formats: set[str],
    require_png: bool = False,
) -> Tuple[str, str, int, int]:
    """Validate actual image bytes instead of trusting filename/content-type."""
    from PIL import Image, UnidentifiedImageError

    Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
    try:
        with Image.open(io.BytesIO(content)) as im:
            fmt = (im.format or "").upper()
            width, height = im.size
            # verify() detects truncated/spoofed payloads without decoding full image.
            im.verify()
    except UnidentifiedImageError:
        raise HTTPException(400, "无法识别图片文件")
    except Exception as e:
        raise HTTPException(400, f"图片文件无效: {e}")

    if require_png and fmt != "PNG":
        raise HTTPException(400, "mask 必须是真实 PNG 文件")
    if fmt not in allowed_formats or fmt not in IMAGE_FORMAT_TO_EXT:
        raise HTTPException(400, f"不支持的图片格式: {fmt or 'unknown'}")
    if width <= 0 or height <= 0:
        raise HTTPException(400, "图片尺寸无效")
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(413, "图片分辨率过大")
    return fmt, IMAGE_FORMAT_TO_EXT[fmt], width, height


def _save_user_upload(content: bytes, user_id: int, ext: str, suffix: str = "") -> str:
    settings = get_settings()
    user_dir = Path(settings.image_dir) / f"user_{user_id}"
    user_dir.mkdir(parents=True, exist_ok=True)
    safe_suffix = f"_{suffix}" if suffix else ""
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{safe_suffix}{ext}"
    (user_dir / name).write_bytes(content)
    return f"/static/images/user_{user_id}/{name}"


async def _snapshot_article_version(
    session,
    article: Article,
    *,
    user_id: int,
    trigger: str,
) -> ArticleVersion:
    last = await session.execute(
        select(ArticleVersion)
        .where(ArticleVersion.article_id == article.id)
        .order_by(ArticleVersion.version.desc())
        .limit(1)
    )
    last_v = last.scalars().first()
    next_ver = (last_v.version + 1) if last_v else 1
    v = ArticleVersion(
        article_id=article.id,
        user_id=user_id,
        version=next_ver,
        title=article.title,
        body=article.body,
        tags=article.tags,
        cover_image=article.cover_image,
        images=article.images or [],
        trigger=trigger,
    )
    session.add(v)
    return v


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

    try:
        task_id = await spawn_agent_task(messages, conversation_id=req.conversation_id, user_id=user.id)
    except RuntimeError as e:
        raise HTTPException(429, str(e))

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
        return _article_payload(a)


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
        return _article_payload(a)


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
        return _article_payload(a)


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


@router.get("/articles/{aid}/diagnoses")
async def list_article_diagnoses(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        res = await s.execute(
            select(ArticleDiagnosis)
            .where(ArticleDiagnosis.article_id == aid, ArticleDiagnosis.user_id == user.id)
            .order_by(ArticleDiagnosis.created_at.desc(), ArticleDiagnosis.id.desc())
            .limit(50)
        )
        return {"items": [d.to_dict() for d in res.scalars().all()]}


@router.get("/articles/{aid}/diagnoses/latest")
async def latest_article_diagnosis(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        res = await s.execute(
            select(ArticleDiagnosis)
            .where(ArticleDiagnosis.article_id == aid, ArticleDiagnosis.user_id == user.id)
            .order_by(ArticleDiagnosis.created_at.desc(), ArticleDiagnosis.id.desc())
            .limit(1)
        )
        d = res.scalars().first()
        return {"item": d.to_dict() if d else None}


@router.get("/articles/{aid}/diagnoses/{did}")
async def get_article_diagnosis(aid: int, did: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        d = await s.get(ArticleDiagnosis, did)
        if not d or d.article_id != aid or d.user_id != user.id:
            raise HTTPException(404, "diagnosis not found")
        return d.to_dict()


@router.post("/articles/{aid}/diagnoses/{did}/apply")
async def apply_article_diagnosis(
    aid: int,
    did: int,
    payload: ApplyDiagnosisRequest | None = None,
    user: User = Depends(get_current_user),
):
    payload = payload or ApplyDiagnosisRequest()
    fields = {str(x).strip().lower() for x in (payload.fields or [])}
    allowed = {"title", "body", "tags"}
    fields = fields & allowed or allowed
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or a.user_id != user.id:
            raise HTTPException(404, "article not found")
        d = await s.get(ArticleDiagnosis, did)
        if not d or d.article_id != aid or d.user_id != user.id:
            raise HTTPException(404, "diagnosis not found")
        report = d.report or {}
        changed: List[str] = []
        await _snapshot_article_version(s, a, user_id=user.id, trigger=f"diagnosis_apply:{did}")
        if "title" in fields and str(report.get("optimized_title") or "").strip():
            a.title = str(report.get("optimized_title")).strip()[:20]
            changed.append("title")
        if "body" in fields and str(report.get("optimized_content") or "").strip():
            a.body = str(report.get("optimized_content")).strip()
            changed.append("body")
        tags = report.get("optimized_tags")
        if "tags" in fields and isinstance(tags, list) and tags:
            normalized_tags: List[str] = []
            seen_tags = set()
            for raw in tags:
                tag = str(raw).strip().lstrip("#＃").strip()
                if not tag:
                    continue
                key = tag.lower()
                if key in seen_tags:
                    continue
                seen_tags.add(key)
                normalized_tags.append(tag)
            a.tags = ",".join(normalized_tags[:10])
            changed.append("tags")
        if not changed:
            raise HTTPException(400, "诊断报告里没有可应用的优化标题、正文或标签")
        a.score = _score_for_article(a)
        d.applied_at = beijing_now_naive()
        await s.commit()
        await s.refresh(a)
        await s.refresh(d)
        return {"ok": True, "changed": changed, "article": _article_payload(a), "diagnosis": d.to_dict()}


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


@router.post("/articles/arrange_images")
async def api_arrange_images(payload: ArticleImageArrangeRequest, user: User = Depends(get_current_user)):
    return await _call_user_tool("arrange_article_images", payload.model_dump(), user)


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
    content = await _read_upload_limited(file)
    _fmt, ext, width, height = _inspect_image(
        content,
        allowed_formats={"PNG"},
        require_png=True,
    )
    url = _save_user_upload(content, user.id, ext, suffix="mask")
    return {"url": url, "width": width, "height": height}


@router.post("/images/generate")
async def api_image(payload: ImageGenRequest, user: User = Depends(get_current_user)):
    from ..config import get_effective_settings
    effective = await get_effective_settings(user.id)
    start = time.perf_counter()
    try:
        urls = await generate_image(
            prompt=payload.prompt,
            size=payload.size,
            quality=payload.quality,
            n=payload.n,
            reference_images=payload.reference_images,
            settings=effective,
        )
        elapsed = int((time.perf_counter() - start) * 1000)
        return {"ok": True, "images": urls, "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        raw = str(e) or type(e).__name__
        timeout = any(x in raw.lower() for x in ("timeout", "timed out", "readtimeout", "524"))
        return {
            "ok": False,
            "images": [],
            "error": f"图片生成失败：{raw[:1000]}",
            "raw_error": raw[:1000],
            "timeout": timeout,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "retry_options": _image_retry_options(payload.prompt, payload.size, payload.quality, payload.n),
        }


@router.post("/upload")
async def upload_image(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    content = await _read_upload_limited(file)
    _fmt, ext, width, height = _inspect_image(
        content,
        allowed_formats=set(IMAGE_FORMAT_TO_EXT),
    )
    url = _save_user_upload(content, user.id, ext)
    return {"url": url, "width": width, "height": height}


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


@router.post("/conversations/batch_delete")
async def batch_delete_conversations(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    raw_ids = payload.get("ids") or payload.get("conversation_ids") or []
    if not isinstance(raw_ids, list):
        raise HTTPException(400, "ids must be a list")

    ids: List[int] = []
    for raw in raw_ids:
        try:
            cid = int(raw)
        except (TypeError, ValueError):
            continue
        if cid > 0 and cid not in ids:
            ids.append(cid)

    if not ids:
        raise HTTPException(400, "ids is required")
    if len(ids) > 100:
        raise HTTPException(400, "一次最多删除 100 条对话")

    async with SessionLocal() as s:
        res = await s.execute(
            select(Conversation).where(
                Conversation.user_id == user.id,
                Conversation.id.in_(ids),
            )
        )
        conversations = res.scalars().all()
        for c in conversations:
            await s.delete(c)
        await s.commit()
        return {"ok": True, "deleted": len(conversations), "requested": len(ids)}


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
        return _article_payload(a)


# ---------- tasks ----------

@router.get("/tasks")
async def list_tasks(limit: int = 50, user: User = Depends(get_current_user)):
    safe_limit = max(1, min(200, int(limit or 50)))
    async with SessionLocal() as s:
        q = (
            select(Task)
            .where(Task.user_id == user.id)
            .order_by(Task.updated_at.desc())
            .limit(safe_limit)
        )
        res = await s.execute(q)
        items = []
        for t in res.scalars().all():
            trace = t.trace or {}
            events = t.events or []
            items.append(
                {
                    "id": t.id,
                    "conversation_id": t.conversation_id,
                    "status": t.status,
                    "trace_id": t.trace_id or "",
                    "trace": trace,
                    "event_count": len(events),
                    "result_preview": (t.result_text or "")[:240],
                    "created_at": beijing_iso(t.created_at),
                    "updated_at": beijing_iso(t.updated_at),
                }
            )
        return {"items": items}


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
            if t:
                stored_events = list(t.events or [])
                for ev in stored_events[max(0, from_index):]:
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                last_type = stored_events[-1].get("type") if stored_events else ""
                if last_type not in ("done", "error", "cancelled"):
                    if t.status == "completed":
                        yield f"data: {json.dumps({'type': 'done', 'text': t.result_text or ''}, ensure_ascii=False)}\n\n"
                    elif t.status == "cancelled":
                        yield f"data: {json.dumps({'type': 'cancelled', 'text': t.result_text or ''}, ensure_ascii=False)}\n\n"
                    else:
                        msg = "任务已中断，请重新发起" if t.status == "stale" else (t.result_text or f"task {t.status}")
                        yield f"data: {json.dumps({'type':'error','message': msg}, ensure_ascii=False)}\n\n"
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


# ---------- user memory ----------

@router.get("/memory")
async def get_user_memory(user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        res = await s.execute(select(UserMemory).where(UserMemory.user_id == user.id))
        mem = res.scalars().first()
        return mem.to_dict() if mem else {
            "user_id": user.id,
            "summary": "",
            "profile": {},
            "recent_briefs": [],
            "updated_at": None,
        }


@router.delete("/memory")
async def clear_user_memory(user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        res = await s.execute(select(UserMemory).where(UserMemory.user_id == user.id))
        mem = res.scalars().first()
        if mem:
            await s.delete(mem)
            await s.commit()
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
        return {
            "ok": True,
            "reply": content[:80],
            "chat_base_url": effective.effective_chat_base_url,
            "chat_model": effective.chat_model,
            "image_base_url": effective.effective_image_base_url,
            "image_model": effective.image_model,
            "image_key_set": bool(effective.effective_image_api_key),
            "public_base_url": effective.public_base_url.rstrip("/"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/settings/image-test")
async def test_image_settings(
    payload: ImageSettingsTestRequest,
    user: User = Depends(get_current_user),
):
    """Real image-model smoke test using the currently effective image config."""
    from ..config import get_effective_settings
    effective = await get_effective_settings(user.id)
    start = time.perf_counter()
    try:
        urls = await generate_image(
            prompt=payload.prompt,
            size=payload.size,
            quality=payload.quality,
            n=1,
            settings=effective,
        )
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": True,
            "images": urls,
            "image": urls[0] if urls else "",
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "image_base_url": effective.effective_image_base_url,
            "image_model": effective.image_model,
            "size": payload.size,
            "quality": payload.quality,
        }
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        raw = str(e) or type(e).__name__
        timeout = any(x in raw.lower() for x in ("timeout", "timed out", "readtimeout", "524"))
        return {
            "ok": False,
            "images": [],
            "error": raw[:1000],
            "timeout": timeout,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "image_base_url": effective.effective_image_base_url,
            "image_model": effective.image_model,
            "size": payload.size,
            "quality": payload.quality,
            "retry_options": _image_retry_options(payload.prompt, payload.size, payload.quality, 1),
        }


@router.post("/settings/static-image-test")
async def test_static_image_public_access(
    payload: StaticImagePublicTestRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    """Create a tiny static image and verify /static/images/... is reachable via a public URL."""
    import httpx
    from ..config import get_effective_settings

    effective = await get_effective_settings(user.id)
    image_dir = Path(effective.image_dir)
    test_dir = image_dir / "_static_public_tests"
    test_dir.mkdir(parents=True, exist_ok=True)
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}.png"
    # 1x1 transparent PNG. Keep it tiny but valid, so both browser and backend
    # fetch can verify real image bytes without involving the image model.
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\x0bIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    (test_dir / name).write_bytes(png)
    static_path = f"/static/images/_static_public_tests/{name}"

    base = (payload.public_base_url if payload.public_base_url is not None else effective.public_base_url).strip().rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    public_url = f"{base}{static_path}"

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as hc:
            r = await hc.get(public_url)
        elapsed = int((time.perf_counter() - start) * 1000)
        content_type = r.headers.get("content-type", "")
        ok = r.status_code == 200 and r.content.startswith(b"\x89PNG") and "image" in content_type.lower()
        return {
            "ok": ok,
            "public_url": public_url,
            "static_path": static_path,
            "status_code": r.status_code,
            "content_type": content_type,
            "bytes": len(r.content),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "message": "静态图片公网访问正常" if ok else "请求到了 URL，但返回内容不是有效图片",
        }
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": False,
            "public_url": public_url,
            "static_path": static_path,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "error": str(e),
            "message": "静态图片公网访问失败，请检查 PUBLIC_BASE_URL、端口、防火墙、反向代理或 /static/images 挂载。",
        }


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
        day = beijing_date_key(a.created_at)
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
        # Backward-compatible alias.
        "base_url": s.effective_chat_base_url,
        "chat_base_url": s.effective_chat_base_url,
        "image_base_url": s.effective_image_base_url,
        "chat_key_set": bool(s.effective_chat_api_key),
        "image_key_set": bool(s.effective_image_api_key),
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
