from __future__ import annotations

import asyncio
import io
import json
from pathlib import Path
import re
import time
import uuid
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy import or_, select

from ..agents.background import cancel_task, get_stream, is_running, spawn_agent_task
from ..agents.tools import (
    TOOLS,
    _article_image_context,
    _article_payload,
    _image_retry_options,
    _score_for_article,
    call_tool_for_user,
    openai_tool_schemas,
)
from ..auth import get_current_user, require_admin
from ..config import (
    get_effective_settings,
    get_settings,
    infer_public_base_url,
    update_settings,
    with_public_base_url_if_missing,
)
from ..database import Article, ArticleDiagnosis, ArticleVersion, Conversation, SessionLocal, Task, Template, User, UserMemory
from ..schemas import (
    AnalyzeImageLayersRequest,
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
    ExtractPixelLayersRequest,
    GenerateArticleRequest,
    ImageGenRequest,
    ImageSettingsTestRequest,
    InpaintRequest,
    MCPCallRequest,
    ModelListRequest,
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
from ..services.llm import chat_completion, generate_image
from ..time_utils import beijing_date_key, beijing_iso, beijing_now_naive

router = APIRouter()

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
MAX_CHAT_REQUEST_MESSAGES = 96
MAX_STORED_CONVERSATION_MESSAGES = 80
MAX_CHAT_MESSAGE_CHARS = 12_000
MAX_CHAT_IMAGES_PER_MESSAGE = 8
MAX_CHAT_TOOL_EVENTS_PER_MESSAGE = 24
MAX_CHAT_TOOL_RESULT_CHARS = 6_000
IMAGE_FORMAT_TO_EXT = {
    "PNG": ".png",
    "JPEG": ".jpg",
    "WEBP": ".webp",
    "GIF": ".gif",
}

ARTICLE_CONTEXT_PREFIX = "【当前笔记上下文"
ARTICLE_IMAGE_INTENT_RE = re.compile(
    r"(图片|图像|照片|图|封面|配图|首图|视觉|画面|构图|海报|设计|图文|上传|改图|编辑图|裁剪|重绘|消除|去掉|删除|移除|增加|添加|替换|这张|第一张|第二张)",
    re.IGNORECASE,
)


def _truncate_chat_text(value: Any, limit: int = MAX_CHAT_MESSAGE_CHARS) -> str:
    text = value if isinstance(value, str) else str(value or "")
    text = text.strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _sanitize_chat_images(images: Any) -> List[str]:
    if not isinstance(images, list):
        return []
    out: List[str] = []
    seen = set()
    for raw in images:
        url = str(raw or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append(_truncate_chat_text(url, 2048))
        if len(out) >= MAX_CHAT_IMAGES_PER_MESSAGE:
            break
    return out


def _compact_chat_tool_result(result: Any) -> Any:
    """Keep persisted tool cards useful without letting raw gateway errors bloat DB."""
    if not isinstance(result, dict):
        return result
    compact: Dict[str, Any] = {}
    for key in (
        "ok",
        "error",
        "timeout",
        "elapsed_ms",
        "elapsed_sec",
        "image",
        "images",
        "generated_cover",
        "generated_content_images",
        "visual_queue",
        "used_image_model",
        "used_image_base_url",
        "retry_options",
        "score",
        "titles",
        "tags",
        "outline",
        "diagnostic",
        "message",
    ):
        if key in result:
            compact[key] = result[key]
    if isinstance(result.get("image_attempts"), list):
        compact["image_attempts"] = result["image_attempts"][:8]
    if isinstance(result.get("workflow"), dict):
        workflow = result["workflow"]
        compact["workflow"] = {
            k: workflow.get(k)
            for k in (
                "generated_cover",
                "generated_content_images",
                "generated_visual_queue",
                "visual_queue",
                "title_candidates",
                "image_attempts",
                "elapsed_sec",
            )
            if k in workflow
        }
        if isinstance(compact["workflow"].get("image_attempts"), list):
            compact["workflow"]["image_attempts"] = compact["workflow"]["image_attempts"][:8]
    if isinstance(result.get("article"), dict):
        article = result["article"]
        compact["article"] = {
            "id": article.get("id"),
            "title": article.get("title"),
            "body": _truncate_chat_text(article.get("body"), 3000),
            "tags": article.get("tags"),
            "status": article.get("status"),
            "cover_image": article.get("cover_image"),
            "images": (article.get("images") or [])[:12],
            "score": article.get("score"),
            "content_stats": article.get("content_stats"),
        }
    text = json.dumps(compact or result, ensure_ascii=False, default=str)
    if len(text) <= MAX_CHAT_TOOL_RESULT_CHARS:
        return compact or result
    return {
        "ok": result.get("ok", True),
        "error": _truncate_chat_text(result.get("error"), 1500) if result.get("error") else None,
        "summary": _truncate_chat_text(text, MAX_CHAT_TOOL_RESULT_CHARS),
        "note": "tool result compacted for stored chat history",
    }


def _sanitize_chat_tool_events(events: Any) -> List[Dict[str, Any]]:
    if not isinstance(events, list):
        return []
    out: List[Dict[str, Any]] = []
    for ev in events[-MAX_CHAT_TOOL_EVENTS_PER_MESSAGE:]:
        if not isinstance(ev, dict):
            continue
        item: Dict[str, Any] = {
            "type": ev.get("type"),
            "name": _truncate_chat_text(ev.get("name"), 120),
        }
        if ev.get("id"):
            item["id"] = _truncate_chat_text(ev.get("id"), 120)
        if ev.get("elapsed_ms") is not None:
            item["elapsed_ms"] = ev.get("elapsed_ms")
        if ev.get("ok") is not None:
            item["ok"] = ev.get("ok")
        if ev.get("step"):
            item["step"] = _truncate_chat_text(ev.get("step"), 120)
        if ev.get("message"):
            item["message"] = _truncate_chat_text(ev.get("message"), 500)
        if ev.get("data") is not None:
            data_text = json.dumps(ev.get("data"), ensure_ascii=False, default=str)
            item["data"] = ev.get("data") if len(data_text) <= 1500 else {"summary": _truncate_chat_text(data_text, 1500)}
        if ev.get("arguments") is not None:
            args = ev.get("arguments")
            arg_text = json.dumps(args, ensure_ascii=False, default=str)
            item["arguments"] = args if len(arg_text) <= 3000 else {"summary": _truncate_chat_text(arg_text, 3000)}
        if ev.get("result") is not None:
            item["result"] = _compact_chat_tool_result(ev.get("result"))
        out.append(item)
    return out


def _sanitize_chat_message(raw: Any) -> Dict[str, Any]:
    msg = raw if isinstance(raw, dict) else {}
    role = str(msg.get("role") or "user").strip()
    if role not in {"user", "assistant", "system", "tool"}:
        role = "user"
    item: Dict[str, Any] = {
        "role": role,
        "content": _truncate_chat_text(msg.get("content")),
        "images": _sanitize_chat_images(msg.get("images")),
    }
    tool_events = _sanitize_chat_tool_events(msg.get("tool_events"))
    if tool_events:
        item["tool_events"] = tool_events
    return item


def _sanitize_conversation_messages(raw_messages: Any) -> List[Dict[str, Any]]:
    if not isinstance(raw_messages, list):
        return []
    return [_sanitize_chat_message(m) for m in raw_messages[-MAX_STORED_CONVERSATION_MESSAGES:]]


def _sanitize_runtime_messages(raw_messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Bound incoming Agent context while preserving current article preface."""
    sanitized = [_sanitize_chat_message(m) for m in raw_messages]
    protected: List[Dict[str, Any]] = []
    dialog: List[Dict[str, Any]] = []
    for msg in sanitized:
        content = str(msg.get("content") or "")
        if msg.get("role") == "system" or content.startswith("【当前笔记上下文"):
            protected.append(msg)
        else:
            dialog.append(msg)
    return protected[-4:] + dialog[-MAX_CHAT_REQUEST_MESSAGES:]


async def _call_user_tool(
    name: str,
    arguments: Dict[str, Any],
    user: User,
    request: Request | None = None,
) -> Dict[str, Any]:
    """Call a registered tool with the authenticated user's context/settings."""
    try:
        settings = None
        if request is not None:
            effective = await get_effective_settings(user.id)
            settings = with_public_base_url_if_missing(effective, str(request.base_url))
        return await call_tool_for_user(name, arguments, user.id, settings=settings)
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


def _is_admin_user(user: User) -> bool:
    return getattr(user, "role", "") == "admin"


def _can_access_owned_record(user: User, owner_id: int | None) -> bool:
    return _is_admin_user(user) or owner_id == user.id


def _public_user_payload(user: User | None, user_id: int | None = None) -> Dict[str, Any]:
    if user:
        return {"id": user.id, "username": user.username, "role": user.role}
    if user_id:
        return {"id": user_id, "username": f"用户 {user_id}", "role": "user"}
    return {"id": None, "username": "未归属", "role": ""}


async def _owner_map_for_ids(session, user_ids: List[int | None]) -> Dict[int, Dict[str, Any]]:
    ids = sorted({int(uid) for uid in user_ids if uid})
    if not ids:
        return {}
    res = await session.execute(select(User).where(User.id.in_(ids)))
    return {u.id: _public_user_payload(u) for u in res.scalars().all()}


def _with_owner_meta(payload: Dict[str, Any], owner_id: int | None, owner_map: Dict[int, Dict[str, Any]]) -> Dict[str, Any]:
    payload = dict(payload)
    payload["user_id"] = owner_id
    payload["owner_user"] = owner_map.get(int(owner_id or 0), _public_user_payload(None, owner_id))
    return payload


def _has_article_context_message(messages: List[Dict[str, Any]]) -> bool:
    return any(str(m.get("content") or "").startswith(ARTICLE_CONTEXT_PREFIX) for m in messages)


def _latest_user_text(messages: List[Dict[str, Any]]) -> str:
    for msg in reversed(messages):
        if msg.get("role") == "user" and not str(msg.get("content") or "").startswith(ARTICLE_CONTEXT_PREFIX):
            return str(msg.get("content") or "")
    return ""


def _build_agent_article_context_message(article: Article, latest_text: str = "") -> Dict[str, Any]:
    """Server-side safety net for API/MCP-like chat clients.

    The web client already sends current-note context before calling
    `/chat/stream`, but external clients can also pass `article_id` directly.
    Without this backend guard the Agent sees the user's wording but not the
    note/images it is supposed to operate on.
    """
    payload = _article_payload(article)
    ctx = payload.get("image_context") or _article_image_context(article)
    visual_items = list(ctx.get("visual_images") or [])
    attach_visuals = bool(ARTICLE_IMAGE_INTENT_RE.search(latest_text or ""))
    attached_images: List[str] = []
    if attach_visuals:
        for item in visual_items[:5]:
            url = item.get("model_url") or item.get("full_url") or item.get("url")
            if url:
                attached_images.append(str(url))
    body = str(payload.get("body") or "")
    preview = body if len(body) <= 1200 else body[:1200] + "…"
    image_line_items: List[str] = []
    for item in visual_items[:12]:
        position = int(item.get("position") or 0)
        role = "首图/封面" if position == 0 else f"第 {position + 1} 张"
        url = str(item.get("url") or "")
        full_url = item.get("model_url") or item.get("full_url")
        suffix = f"（完整URL：{full_url}）" if full_url and full_url != url else ""
        image_line_items.append(f"{role}：{url}{suffix}")
    image_lines = "\n".join(image_line_items) if image_line_items else "无"
    content = (
        f"{ARTICLE_CONTEXT_PREFIX} · id={article.id}】\n"
        f"标题：{payload.get('title') or ''}\n"
        f"状态：{payload.get('status') or ''}\n"
        f"标签：{' '.join(payload.get('tags') or [])}\n\n"
        f"图片：共 {int(ctx.get('image_count') or 0)} 张（小红书展示队列：第 1 张就是首图/封面）\n{image_lines}\n"
        + (
            f"本轮涉及视觉/图片，已随上下文附带前 {len(attached_images)} 张图片供视觉理解。\n\n"
            if attached_images
            else "本轮先提供图片 URL；如需视觉像素级分析，请按 URL 或 read_article/image_context 判断。\n\n"
        )
        + f"正文：\n{preview}\n\n"
        "---\n"
        f"当前默认操作笔记 {article.id}；如用户指定其它笔记 ID 或多个笔记，请按用户指定 ID 调用工具。"
        "写入/改图/编排必须通过工具完成。read_article 会返回 cover_image、images、完整 URL 和 image_context。"
    )
    return {"role": "user", "content": content, "images": attached_images}


def _mcp_http_response(result: Any) -> Dict[str, Any]:
    """HTTP bridge response that preserves legacy envelope and real tool status."""
    if not isinstance(result, dict):
        return {"ok": True, "result": result}
    response: Dict[str, Any] = {"ok": result.get("ok") is not False, "result": result}
    for key in (
        "error",
        "raw_error",
        "timeout",
        "elapsed_ms",
        "elapsed_sec",
        "article_id",
        "article",
        "image",
        "images",
        "image_attempts",
        "retry_options",
    ):
        if key in result:
            response[key] = result[key]
    return response


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
async def chat_stream(req: ChatRequest, request: Request, user: User = Depends(get_current_user)):
    context_article_id = req.article_id
    if req.conversation_id:
        async with SessionLocal() as s:
            conv = await s.get(Conversation, req.conversation_id)
            if not conv or not _can_access_owned_record(user, conv.user_id):
                raise HTTPException(404, "conversation not found")
            if not context_article_id and conv.article_id:
                context_article_id = conv.article_id

    messages: List[Dict[str, Any]] = []
    for m in req.messages:
        messages.append(
            {"role": m.role, "content": m.content, "images": m.images}
        )
    messages = _sanitize_runtime_messages(messages)

    if context_article_id and not _has_article_context_message(messages):
        try:
            context_article_id_int = int(context_article_id)
        except Exception:
            raise HTTPException(400, "article_id must be an integer")
        async with SessionLocal() as s:
            article = await s.get(Article, context_article_id_int)
            if not article or not _can_access_owned_record(user, article.user_id):
                raise HTTPException(404, "article not found")
            messages.insert(0, _build_agent_article_context_message(article, _latest_user_text(messages)))

    try:
        task_id = await spawn_agent_task(
            messages,
            conversation_id=req.conversation_id,
            user_id=user.id,
            request_public_base_url=infer_public_base_url(str(request.base_url)),
        )
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
        q = select(Article).order_by(Article.updated_at.desc()).limit(limit)
        if not _is_admin_user(user):
            q = q.where(Article.user_id == user.id)
        res = await s.execute(
            q
        )
        articles = res.scalars().all()
        if not _is_admin_user(user):
            return {"items": [a.to_dict() for a in articles]}
        owners = await _owner_map_for_ids(s, [a.user_id for a in articles])
        return {"items": [_with_owner_meta(a.to_dict(), a.user_id, owners) for a in articles]}


@router.get("/articles/{aid}")
async def get_article(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "not found")
        payload = _article_payload(a)
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [a.user_id])
            payload = _with_owner_meta(payload, a.user_id, owners)
        return payload


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
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "not found")
        data = payload.model_dump(exclude_unset=True)
        if "tags" in data and data["tags"] is not None:
            a.tags = ",".join(data["tags"])
            data.pop("tags")
        for k, v in data.items():
            setattr(a, k, v)
        await s.commit()
        await s.refresh(a)
        result = _article_payload(a)
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [a.user_id])
            result = _with_owner_meta(result, a.user_id, owners)
        return result


@router.delete("/articles/{aid}")
async def delete_article(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or not _can_access_owned_record(user, a.user_id):
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
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "article not found")
        q = select(ArticleDiagnosis).where(ArticleDiagnosis.article_id == aid)
        if not _is_admin_user(user):
            q = q.where(ArticleDiagnosis.user_id == user.id)
        res = await s.execute(
            q
            .order_by(ArticleDiagnosis.created_at.desc(), ArticleDiagnosis.id.desc())
            .limit(50)
        )
        return {"items": [d.to_dict() for d in res.scalars().all()]}


@router.get("/articles/{aid}/diagnoses/latest")
async def latest_article_diagnosis(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "article not found")
        q = select(ArticleDiagnosis).where(ArticleDiagnosis.article_id == aid)
        if not _is_admin_user(user):
            q = q.where(ArticleDiagnosis.user_id == user.id)
        res = await s.execute(
            q
            .order_by(ArticleDiagnosis.created_at.desc(), ArticleDiagnosis.id.desc())
            .limit(1)
        )
        d = res.scalars().first()
        return {"item": d.to_dict() if d else None}


@router.get("/articles/{aid}/diagnoses/{did}")
async def get_article_diagnosis(aid: int, did: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "article not found")
        d = await s.get(ArticleDiagnosis, did)
        if not d or d.article_id != aid or (not _is_admin_user(user) and d.user_id != user.id):
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
        if not a or not _can_access_owned_record(user, a.user_id):
            raise HTTPException(404, "article not found")
        d = await s.get(ArticleDiagnosis, did)
        if not d or d.article_id != aid or (not _is_admin_user(user) and d.user_id != user.id):
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
        result = _article_payload(a)
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [a.user_id])
            result = _with_owner_meta(result, a.user_id, owners)
        return {"ok": True, "changed": changed, "article": result, "diagnosis": d.to_dict()}


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
async def api_crop(payload: CropImageRequest, request: Request, user: User = Depends(get_current_user)):
    return await _call_user_tool("crop_image", payload.model_dump(), user, request)


@router.post("/images/inpaint")
async def api_inpaint(payload: InpaintRequest, request: Request, user: User = Depends(get_current_user)):
    return await _call_user_tool("inpaint_image", payload.model_dump(), user, request)


@router.post("/images/remove_object")
async def api_remove_object(payload: RemoveObjectRequest, request: Request, user: User = Depends(get_current_user)):
    return await _call_user_tool("remove_object", payload.model_dump(), user, request)


@router.post("/images/edit")
async def api_edit_image(payload: EditImageRequest, request: Request, user: User = Depends(get_current_user)):
    return await _call_user_tool("edit_image", payload.model_dump(), user, request)


def _extract_json_object(text: str) -> Dict[str, Any]:
    value = (text or "").strip()
    if value.startswith("```"):
        value = value.strip("`")
        if value.lower().startswith("json"):
            value = value[4:].strip()
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        pass
    start = value.find("{")
    end = value.rfind("}")
    if start >= 0 and end > start:
        try:
            parsed = json.loads(value[start : end + 1])
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _successful_image_attempt(attempts: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    return next((a for a in attempts if isinstance(a, dict) and a.get("status") == "success"), None)


def _clamp_norm_bbox(value: Any) -> List[int]:
    if not isinstance(value, list) or len(value) < 4:
        return [0, 0, 1000, 1000]
    nums: List[int] = []
    for item in value[:4]:
        try:
            nums.append(int(round(float(item))))
        except Exception:
            nums.append(0)
    x, y, w, h = nums
    x = max(0, min(999, x))
    y = max(0, min(999, y))
    w = max(1, min(1000 - x, w))
    h = max(1, min(1000 - y, h))
    return [x, y, w, h]


def _local_image_size(image_url: str) -> Tuple[int, int]:
    from PIL import Image
    from ..services.llm import _resolve_local_path

    try:
        path = _resolve_local_path(image_url)
        if path.exists():
            with Image.open(path) as im:
                return im.size
    except Exception:
        pass
    return 0, 0


def _connected_components(mask, *, min_pixels: int = 60) -> List[Tuple[int, int, int, int, int]]:
    """Pure-Pillow connected components on a binary L mask.

    Returns small-image boxes as (x, y, w, h, pixels).  Kept local to avoid
    adding OpenCV/skimage runtime dependencies for deploys.
    """
    width, height = mask.size
    data = mask.tobytes()
    visited = bytearray(width * height)
    boxes: List[Tuple[int, int, int, int, int]] = []
    for y in range(height):
        row = y * width
        for x in range(width):
            idx = row + x
            if visited[idx] or data[idx] < 128:
                continue
            stack = [idx]
            visited[idx] = 1
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            while stack:
                cur = stack.pop()
                cy, cx = divmod(cur, width)
                count += 1
                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= width or ny >= height:
                        continue
                    ni = ny * width + nx
                    if not visited[ni] and data[ni] >= 128:
                        visited[ni] = 1
                        stack.append(ni)
            if count >= min_pixels:
                boxes.append((min_x, min_y, max_x - min_x + 1, max_y - min_y + 1, count))
    return boxes


def _merge_close_boxes(
    boxes: List[Tuple[int, int, int, int, int]],
    *,
    width: int,
    height: int,
) -> List[Tuple[int, int, int, int, int]]:
    """Merge nearby components into PS-like groups (text lines, stickers)."""
    pad_x = max(6, int(width * 0.012))
    pad_y = max(5, int(height * 0.008))
    items = [list(b) for b in boxes]
    changed = True
    while changed:
        changed = False
        out: List[List[int]] = []
        while items:
            cur = items.pop()
            x, y, w, h, c = cur
            merged = False
            for other in items:
                ox, oy, ow, oh, oc = other
                close = not (
                    x + w + pad_x < ox
                    or ox + ow + pad_x < x
                    or y + h + pad_y < oy
                    or oy + oh + pad_y < y
                )
                if close:
                    nx = min(x, ox)
                    ny = min(y, oy)
                    nx2 = max(x + w, ox + ow)
                    ny2 = max(y + h, oy + oh)
                    other[:] = [nx, ny, nx2 - nx, ny2 - ny, c + oc]
                    changed = True
                    merged = True
                    break
            if not merged:
                out.append(cur)
        items = out
    return [tuple(x) for x in items]  # type: ignore[return-value]


def _png_bytes(img) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@router.post("/images/extract_pixel_layers")
async def api_extract_pixel_layers(
    payload: ExtractPixelLayersRequest,
    user: User = Depends(get_current_user),
):
    """Local deterministic PS-like pixel decomposition.

    Unlike /images/analyze_layers, this does not ask the model to describe boxes.
    It extracts actual transparent PNG layer crops and a cleaned/blur-filled
    background, so moving/deleting a layer changes real pixels like a rough PSD.
    """
    from PIL import Image, ImageChops, ImageFilter, ImageOps
    from ..services.llm import _resolve_local_path

    image_url = payload.image_url.strip()
    if not image_url:
        raise HTTPException(400, "image_url is required")
    start = time.perf_counter()
    try:
        path = _resolve_local_path(image_url)
    except Exception as e:
        return {"ok": False, "error": f"只支持本系统 /static/images 图片做像素拆层：{e}"}
    if not path.exists():
        return {"ok": False, "error": f"image not found: {image_url}"}

    try:
        original = Image.open(path).convert("RGBA")
        width, height = original.size
        max_side = 900
        scale = min(1.0, max_side / max(width, height))
        small_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        rgb_small = original.convert("RGB").resize(small_size, Image.Resampling.LANCZOS)
        gray = ImageOps.grayscale(rgb_small)
        blur_radius = max(6, int(max(small_size) / 34))
        blurred = rgb_small.filter(ImageFilter.GaussianBlur(blur_radius))
        diff = ImageChops.difference(rgb_small, blurred).convert("L")
        edges = gray.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
        hsv = rgb_small.convert("HSV")
        saturation = hsv.getchannel("S")

        threshold = int(42 - payload.sensitivity * 28)
        diff_mask = diff.point(lambda p: 255 if p > threshold else 0, mode="L")
        edge_mask = edges.point(lambda p: 255 if p > max(14, threshold - 8) else 0, mode="L")
        sat_mask = saturation.point(lambda p: 255 if p > int(120 - payload.sensitivity * 45) else 0, mode="L")
        fine_mask = ImageChops.lighter(ImageChops.lighter(diff_mask, edge_mask), sat_mask)
        fine_mask = fine_mask.filter(ImageFilter.MaxFilter(3))
        grouped_mask = fine_mask.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(7))

        small_w, small_h = small_size
        min_pixels = max(50, int(small_w * small_h * 0.00018))
        max_pixels = int(small_w * small_h * 0.38)
        boxes = _connected_components(grouped_mask, min_pixels=min_pixels)
        # Drop frame/noise components that span almost the entire canvas; edge
        # detection often produces a sparse full-image border, which would merge
        # every real element into one useless giant layer.
        boxes = [
            b
            for b in boxes
            if b[4] <= max_pixels
            and b[2] >= 5
            and b[3] >= 5
            and not (b[2] > small_w * 0.92 and b[3] > small_h * 0.92)
        ]
        boxes = _merge_close_boxes(boxes, width=small_w, height=small_h)
        boxes = [b for b in boxes if b[4] <= max_pixels]
        boxes = sorted(boxes, key=lambda b: b[4], reverse=True)[: payload.max_layers]
        boxes = sorted(boxes, key=lambda b: (b[1], b[0]))

        fine_full = fine_mask.resize((width, height), Image.Resampling.NEAREST).filter(ImageFilter.MaxFilter(5))
        cleanup_mask = Image.new("L", (width, height), 0)
        # Build a cleanup mask from actual selected layer alpha, not from every detected speckle.
        layers: List[Dict[str, Any]] = []
        for idx, (sx, sy, sw, sh, pixels) in enumerate(boxes):
            pad = max(3, int(8 / max(scale, 0.25)))
            x = max(0, int(sx / scale) - pad)
            y = max(0, int(sy / scale) - pad)
            x2 = min(width, int((sx + sw) / scale) + pad)
            y2 = min(height, int((sy + sh) / scale) + pad)
            if x2 <= x or y2 <= y:
                continue
            bbox = (x, y, x2, y2)
            alpha = fine_full.crop(bbox).filter(ImageFilter.MaxFilter(max(3, pad // 2 * 2 + 1)))
            if not alpha.getbbox():
                continue
            crop = original.crop(bbox)
            crop.putalpha(alpha)
            url = _save_user_upload(_png_bytes(crop), user.id, ".png", suffix=f"layer_{idx + 1}")
            mask_piece = Image.new("L", (width, height), 0)
            mask_piece.paste(alpha, bbox)
            cleanup_mask = ImageChops.lighter(cleanup_mask, mask_piece)
            layer_type = "text_pixel" if (x2 - x) > (y2 - y) * 2.2 and (y2 - y) < height * 0.18 else "pixel"
            layers.append(
                {
                    "id": f"pixel_{idx + 1}",
                    "type": layer_type,
                    "label": ("文本/标识像素层" if layer_type == "text_pixel" else "像素元素层") + f" {idx + 1}",
                    "pixel_url": url,
                    "x": x,
                    "y": y,
                    "w": x2 - x,
                    "h": y2 - y,
                    "area": int(pixels / max(scale * scale, 0.0001)),
                    "zIndex": idx + 1,
                }
            )

        cleanup_mask = cleanup_mask.filter(ImageFilter.MaxFilter(max(9, int(min(width, height) * 0.008) // 2 * 2 + 1)))
        background_blur = original.filter(ImageFilter.GaussianBlur(max(10, int(max(width, height) * 0.018))))
        cleaned = Image.composite(background_blur, original, cleanup_mask)
        background_url = _save_user_upload(_png_bytes(cleaned), user.id, ".png", suffix="clean_bg")
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": True,
            "image_url": image_url,
            "background_image": background_url,
            "canvas": {"width": width, "height": height},
            "layers": layers,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "note": "本地像素拆层：返回真实透明 PNG 图层和清理背景；文字作为像素层，不等同于 OCR 可编辑文本。",
        }
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        return {"ok": False, "error": f"像素拆层失败：{e}", "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}


@router.post("/images/analyze_layers")
async def api_analyze_image_layers(
    payload: AnalyzeImageLayersRequest,
    request: Request,
    user: User = Depends(get_current_user),
):
    """Use current vision/chat model to produce semantic pseudo-layers.

    This is intentionally a semantic decomposition, not a claim that the flat
    PNG/JPG contains real PS layers.  Frontend can use the returned text/object
    regions for OCR-style text boxes, AI inpaint/delete, and movable overlays.
    """
    effective = with_public_base_url_if_missing(await get_effective_settings(user.id), str(request.base_url))
    image_url = payload.image_url.strip()
    if not image_url:
        raise HTTPException(400, "image_url is required")
    width, height = _local_image_size(image_url)
    width = width or int(payload.width or 0)
    height = height or int(payload.height or 0)
    start = time.perf_counter()
    prompt = (
        "你是图片语义拆层引擎。请分析这张小红书海报/图片，把扁平图拆解成可编辑的语义伪图层。"
        "不要解释，只返回严格 JSON。\n\n"
        "目标：识别文本层、贴纸/标签/图标/主体等元素层、背景层。"
        "bbox_norm 使用 [x,y,w,h]，坐标为 0-1000 相对坐标，不要使用像素坐标。"
        "文本层必须尽量 OCR 出 text；不确定也要给 approximate text。"
        "元素层 label 要简短，如 价格标签、评价卡片、房间主体、海浪背景、装饰贴纸。"
        "每个层给 edit_prompt，描述如果用户想修改这个区域可如何局部重绘。"
        "最多 18 个层，优先输出可编辑价值高的层。\n\n"
        f"已知图片尺寸：{width or 'unknown'}x{height or 'unknown'}。\n"
        f"用户提示：{payload.hint or '无'}\n\n"
        'JSON格式：{"canvas":{"width":数字或0,"height":数字或0},'
        '"layers":[{"id":"layer_1","type":"text|object|background|decoration","label":"名称",'
        '"text":"文本层内容或空","bbox_norm":[0,0,100,100],"confidence":0.0到1.0,'
        '"font_hint":"字体风格","color_hint":"#RRGGBB或颜色描述","edit_prompt":"局部编辑提示","zIndex":数字}]}'
    )
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": "你只输出可解析 JSON，不输出 markdown。"},
                {"role": "user", "content": prompt, "images": [image_url]},
            ],
            temperature=0.1,
            settings=effective,
        )
        content = resp.choices[0].message.content or ""
        data = _extract_json_object(content)
        raw_layers = data.get("layers") if isinstance(data.get("layers"), list) else []
        layers: List[Dict[str, Any]] = []
        for idx, item in enumerate(raw_layers[:24]):
            if not isinstance(item, dict):
                continue
            layer_type = str(item.get("type") or "object").strip().lower()
            if layer_type not in {"text", "object", "background", "decoration"}:
                layer_type = "object"
            layers.append(
                {
                    "id": str(item.get("id") or f"layer_{idx + 1}"),
                    "type": layer_type,
                    "label": str(item.get("label") or ("文本" if layer_type == "text" else "元素"))[:80],
                    "text": str(item.get("text") or ""),
                    "bbox_norm": _clamp_norm_bbox(item.get("bbox_norm") or item.get("bbox")),
                    "confidence": float(item.get("confidence") or 0),
                    "font_hint": str(item.get("font_hint") or ""),
                    "color_hint": str(item.get("color_hint") or ""),
                    "edit_prompt": str(item.get("edit_prompt") or ""),
                    "zIndex": int(float(item.get("zIndex") or idx)),
                }
            )
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": True,
            "image_url": image_url,
            "canvas": {"width": width, "height": height},
            "layers": layers,
            "raw": data,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
        }
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": False,
            "error": f"图片拆解失败：{e}",
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
        }


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
async def api_image(payload: ImageGenRequest, request: Request, user: User = Depends(get_current_user)):
    effective = with_public_base_url_if_missing(await get_effective_settings(user.id), str(request.base_url))
    start = time.perf_counter()
    attempts: List[Dict[str, Any]] = []
    try:
        urls = await generate_image(
            prompt=payload.prompt,
            size=payload.size,
            quality=payload.quality,
            n=payload.n,
            reference_images=payload.reference_images,
            settings=effective,
            attempt_trace=attempts,
        )
        elapsed = int((time.perf_counter() - start) * 1000)
        used = _successful_image_attempt(attempts)
        return {
            "ok": True,
            "images": urls,
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "image_attempts": attempts,
            "used_image_model": used.get("model") if used else effective.image_model,
            "used_image_base_url": used.get("base_url") if used else effective.effective_image_base_url,
        }
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
            "image_attempts": attempts,
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
    from ..services.llm import chat_completion
    effective = await get_effective_settings(user.id)
    async with SessionLocal() as s:
        art = await s.get(Article, payload.article_id)
        if not art or not _can_access_owned_record(user, art.user_id):
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
        q = select(Conversation).order_by(Conversation.updated_at.desc()).limit(100)
        if not _is_admin_user(user):
            q = q.where(Conversation.user_id == user.id)
        res = await s.execute(
            q
        )
        conversations = res.scalars().all()
        if not _is_admin_user(user):
            return {"items": [c.to_dict() for c in conversations]}
        owners = await _owner_map_for_ids(s, [c.user_id for c in conversations])
        return {"items": [_with_owner_meta(c.to_dict(), c.user_id, owners) for c in conversations]}


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
        q = select(Conversation).where(Conversation.id.in_(ids))
        if not _is_admin_user(user):
            q = q.where(Conversation.user_id == user.id)
        res = await s.execute(q)
        conversations = res.scalars().all()
        for c in conversations:
            await s.delete(c)
        await s.commit()
        return {"ok": True, "deleted": len(conversations), "requested": len(ids)}


@router.get("/conversations/{cid}")
async def get_conversation(cid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or not _can_access_owned_record(user, c.user_id):
            raise HTTPException(404, "not found")
        payload = c.to_dict()
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [c.user_id])
            payload = _with_owner_meta(payload, c.user_id, owners)
        return payload


@router.post("/conversations")
async def create_conversation(payload: Dict[str, Any], user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        article_id = payload.get("article_id")
        if article_id:
            a = await s.get(Article, int(article_id))
            if not a or not _can_access_owned_record(user, a.user_id):
                raise HTTPException(404, "article not found")
        c = Conversation(
            user_id=user.id,
            title=payload.get("title", "新对话"),
            article_id=article_id,
            messages=_sanitize_conversation_messages(payload.get("messages", [])),
        )
        s.add(c)
        await s.commit()
        await s.refresh(c)
        return c.to_dict()


@router.patch("/conversations/{cid}")
async def update_conversation(cid: int, payload: Dict[str, Any], user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or not _can_access_owned_record(user, c.user_id):
            raise HTTPException(404, "not found")
        if "article_id" in payload and payload["article_id"]:
            a = await s.get(Article, int(payload["article_id"]))
            if not a or not _can_access_owned_record(user, a.user_id):
                raise HTTPException(404, "article not found")
        for k in ("title", "messages", "article_id"):
            if k in payload:
                if k == "messages":
                    setattr(c, k, _sanitize_conversation_messages(payload[k]))
                else:
                    setattr(c, k, payload[k])
        await s.commit()
        await s.refresh(c)
        result = c.to_dict()
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [c.user_id])
            result = _with_owner_meta(result, c.user_id, owners)
        return result


@router.delete("/conversations/{cid}")
async def delete_conversation(cid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        c = await s.get(Conversation, cid)
        if not c or not _can_access_owned_record(user, c.user_id):
            raise HTTPException(404, "not found")
        await s.delete(c)
        await s.commit()
        return {"ok": True}


# ---------- article versions ----------

@router.get("/articles/{aid}/versions")
async def list_versions(aid: int, user: User = Depends(get_current_user)):
    async with SessionLocal() as s:
        a = await s.get(Article, aid)
        if not a or not _can_access_owned_record(user, a.user_id):
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
        if not a or not _can_access_owned_record(user, a.user_id):
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
        if not a or not _can_access_owned_record(user, a.user_id):
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
        result = _article_payload(a)
        if _is_admin_user(user):
            owners = await _owner_map_for_ids(s, [a.user_id])
            result = _with_owner_meta(result, a.user_id, owners)
        return result


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
    return get_settings().public_dict(include_secrets=(user.role == "admin"))


@router.put("/settings")
async def put_settings(payload: SettingsUpdate, user: User = Depends(require_admin)):
    new = update_settings(payload.model_dump(exclude_unset=True))
    return new.public_dict(include_secrets=True)


@router.post("/settings/test")
async def test_settings(user: User = Depends(get_current_user)):
    """Quick connectivity test against the currently saved config."""
    from ..services.llm import chat_completion
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
            "used_chat_model": getattr(r, "model", "") or effective.chat_model,
            "chat_model_candidates": effective.chat_model_candidates,
            "image_base_url": effective.effective_image_base_url,
            "image_model": effective.image_model,
            "image_model_candidates": effective.image_model_candidates,
            "image_key_set": bool(effective.effective_image_api_key),
            "public_base_url": effective.public_base_url.rstrip("/"),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


@router.post("/settings/model-list")
async def list_model_options(payload: ModelListRequest, user: User = Depends(get_current_user)):
    """Fetch OpenAI-compatible /models for a specific row's base_url/key."""
    import httpx

    effective = await get_effective_settings(user.id)
    kind = (payload.kind or "image").strip().lower()
    base_url = (payload.base_url or "").strip().rstrip("/")
    api_key = (payload.api_key or "").strip()
    if not base_url:
        base_url = effective.effective_image_base_url if kind == "image" else effective.effective_chat_base_url
    if not api_key:
        api_key = effective.effective_image_api_key if kind == "image" else effective.effective_chat_api_key
    if not base_url:
        return {"ok": False, "error": "base_url 不能为空"}
    if not api_key:
        return {"ok": False, "error": "api_key 不能为空"}
    if not (base_url.startswith("http://") or base_url.startswith("https://")):
        return {"ok": False, "error": "base_url 必须以 http:// 或 https:// 开头"}
    try:
        async with httpx.AsyncClient(timeout=20.0) as hc:
            r = await hc.get(f"{base_url}/models", headers={"Authorization": f"Bearer {api_key}"})
        if r.status_code >= 400:
            detail = r.text[:800]
            try:
                detail = json.dumps(r.json(), ensure_ascii=False)[:800]
            except Exception:
                pass
            return {"ok": False, "error": f"HTTP {r.status_code}: {detail}", "models": []}
        data = r.json()
        raw_items = data.get("data") if isinstance(data, dict) else data
        models: List[str] = []
        if isinstance(raw_items, list):
            for item in raw_items:
                mid = ""
                if isinstance(item, dict):
                    mid = str(item.get("id") or item.get("model") or item.get("name") or "").strip()
                elif isinstance(item, str):
                    mid = item.strip()
                if mid and mid not in models:
                    models.append(mid)
        return {"ok": True, "models": models, "count": len(models), "base_url": base_url}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}", "models": []}


@router.post("/settings/image-test")
async def test_image_settings(
    payload: ImageSettingsTestRequest,
    user: User = Depends(get_current_user),
):
    """Real image-model smoke test using the currently effective image config."""
    effective = await get_effective_settings(user.id)
    start = time.perf_counter()
    attempts: List[Dict[str, Any]] = []
    try:
        urls = await generate_image(
            prompt=payload.prompt,
            size=payload.size,
            quality=payload.quality,
            n=1,
            settings=effective,
            attempt_trace=attempts,
        )
        elapsed = int((time.perf_counter() - start) * 1000)
        used = _successful_image_attempt(attempts)
        return {
            "ok": True,
            "images": urls,
            "image": urls[0] if urls else "",
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "image_base_url": used.get("base_url") if used else effective.effective_image_base_url,
            "image_model": used.get("model") if used else effective.image_model,
            "image_model_candidates": effective.image_model_candidates,
            "image_attempts": attempts,
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
            "image_model_candidates": effective.image_model_candidates,
            "image_attempts": attempts,
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
    """Create a tiny static image and verify /static/images/... reachability.

    The same endpoint is useful in both modes:
    - local mode: confirms the browser/backend can read /static/images via the
      dev proxy or direct backend origin, but marks it as not provider-readable.
    - server mode: confirms the configured/request public origin is reachable
      and can safely be sent to upstream image/vision providers as a URL.
    """
    import httpx
    from urllib.parse import urlparse

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

    supplied_base = ""
    source = "request"
    if payload.public_base_url is not None and payload.public_base_url.strip():
        supplied_base = payload.public_base_url
        source = "input"
    elif effective.public_base_url.strip():
        supplied_base = effective.public_base_url
        source = "settings"
    else:
        supplied_base = str(request.base_url)
    base = supplied_base.strip().rstrip("/")

    parsed = urlparse(base)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return {
            "ok": False,
            "public_ok": False,
            "provider_readable": False,
            "mode": "invalid",
            "source": source,
            "public_url": f"{base}{static_path}" if base else static_path,
            "static_path": static_path,
            "elapsed_ms": 0,
            "elapsed_sec": 0,
            "error": "PUBLIC_BASE_URL 必须是 http(s):// 开头的完整地址",
            "message": "静态图片公网访问失败：部署访问地址格式无效。",
        }

    provider_base = infer_public_base_url(base)
    provider_readable = bool(provider_base)
    mode = "server" if provider_readable else "local"
    public_url = f"{base}{static_path}"

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as hc:
            r = await hc.get(public_url)
        elapsed = int((time.perf_counter() - start) * 1000)
        content_type = r.headers.get("content-type", "")
        ok = r.status_code == 200 and r.content.startswith(b"\x89PNG") and "image" in content_type.lower()
        public_ok = ok and provider_readable
        if public_ok:
            message = "静态图片公网访问正常，外部模型可直接读取该 /static/images/... URL。"
        elif ok:
            message = (
                "静态图片本地访问正常；当前地址是 localhost/内网/保留地址，外部模型不可直接抓取。"
                "本地模式会自动改用文件上传或原图 data URL，不会压缩画质。"
            )
        else:
            message = "请求到了 URL，但返回内容不是有效图片"
        return {
            "ok": ok,
            "public_ok": public_ok,
            "provider_readable": provider_readable,
            "mode": mode,
            "source": source,
            "provider_base_url": provider_base,
            "public_url": public_url,
            "static_path": static_path,
            "status_code": r.status_code,
            "content_type": content_type,
            "bytes": len(r.content),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "message": message,
        }
    except Exception as e:
        elapsed = int((time.perf_counter() - start) * 1000)
        return {
            "ok": False,
            "public_ok": False,
            "provider_readable": provider_readable,
            "mode": mode,
            "source": source,
            "provider_base_url": provider_base,
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
    return _mcp_http_response(result)


@router.get("/tools")
async def tools_openai_schema(user: User = Depends(get_current_user)):
    """OpenAI function-calling schemas for any external agent that wants to drive the same tools."""
    return {"tools": openai_tool_schemas()}
