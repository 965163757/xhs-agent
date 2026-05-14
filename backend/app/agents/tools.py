"""Agent tool definitions. Each tool is both an OpenAI function-calling schema
and an MCP-compatible callable. The backend API and the embedded MCP endpoints
share this registry."""
from __future__ import annotations

import asyncio
import contextvars
import json
import re
import time
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional
from urllib.parse import urljoin, urlparse

from sqlalchemy import or_, select

from ..config import get_settings
from ..database import Article, ArticleDiagnosis, ArticleVersion, Conversation, SessionLocal, Template
from ..services.llm import (
    chat_completion,
    crop_image,
    edit_image,
    generate_image,
    get_current_settings,
    reset_current_settings,
    set_current_settings,
)


ToolFn = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]
ProgressEmitter = Callable[[Dict[str, Any]], None]

_current_user_id: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "_current_user_id", default=None
)
_tool_progress_emitter: contextvars.ContextVar[Optional[ProgressEmitter]] = contextvars.ContextVar(
    "_tool_progress_emitter", default=None
)


def get_tool_user_id() -> Optional[int]:
    return _current_user_id.get()


def set_tool_user_id(uid: Optional[int]) -> contextvars.Token:
    return _current_user_id.set(uid)


def reset_tool_user_id(token: contextvars.Token) -> None:
    _current_user_id.reset(token)


def set_tool_progress_emitter(emitter: Optional[ProgressEmitter]) -> contextvars.Token:
    return _tool_progress_emitter.set(emitter)


def reset_tool_progress_emitter(token: contextvars.Token) -> None:
    _tool_progress_emitter.reset(token)


def emit_tool_progress(message: str, *, step: str = "", data: Optional[Dict[str, Any]] = None) -> None:
    emitter = _tool_progress_emitter.get()
    if not emitter:
        return
    payload: Dict[str, Any] = {
        "type": "tool_progress",
        "message": message,
    }
    if step:
        payload["step"] = step
    if data:
        payload["data"] = data
    emitter(payload)


def _elapsed_ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def _fmt_elapsed(ms: int) -> str:
    seconds = ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    return f"{int(seconds // 60)}m{int(seconds % 60)}s"


def _safe_int(value: Any, default: int, *, min_value: Optional[int] = None, max_value: Optional[int] = None) -> int:
    try:
        out = int(value)
    except Exception:
        out = default
    if min_value is not None:
        out = max(min_value, out)
    if max_value is not None:
        out = min(max_value, out)
    return out


def _optional_article_id(value: Any) -> Optional[int]:
    """Treat 0/empty/non-numeric article ids as intentionally unbound."""
    try:
        out = int(value)
    except Exception:
        return None
    return out if out > 0 else None


def _is_timeout_error(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(x in text for x in ("timeout", "timed out", "readtimeout", "524"))


def _friendly_tool_error(exc: BaseException, *, elapsed_ms: int = 0, action: str = "操作") -> str:
    raw = str(exc) or type(exc).__name__
    raw_short = raw[:500]
    prefix = f"{action}失败"
    if _is_timeout_error(exc):
        prefix = f"{action}超时"
        return f"{prefix}：已等待 {_fmt_elapsed(elapsed_ms)}，上游仍未返回。建议降低 size/quality、简化 prompt，或稍后重试。原始错误：{raw_short}"
    if "502" in raw or "upstream" in raw.lower():
        return f"{prefix}：上游图片服务返回 502/Upstream error，通常是模型队列或供应商侧失败。耗时 {_fmt_elapsed(elapsed_ms)}。原始错误：{raw_short}"
    if "524" in raw:
        return f"{prefix}：网关 524 超时，图片服务处理时间过长。耗时 {_fmt_elapsed(elapsed_ms)}。原始错误：{raw_short}"
    if "blocked" in raw.lower() or "403" in raw:
        return f"{prefix}：请求被图片服务拦截或拒绝。请尝试调整 prompt，避免敏感/过度复杂描述。原始错误：{raw_short}"
    return f"{prefix}：{raw_short}"


def _image_retry_options(prompt: str, size: str, quality: str, n: int = 1) -> List[Dict[str, Any]]:
    """Manual retry suggestions. Never silently lowers quality."""
    options: List[Dict[str, Any]] = []
    if size not in {"1024x1024", "1152x1536", "1536x2048", "2048x1536", "2048x2048", "2048x1152"}:
        if "x" in str(size):
            try:
                w, h = [int(x) for x in str(size).lower().split("x", 1)]
                if h >= w:
                    smaller = "1152x1536" if h / max(w, 1) > 1.15 else "1024x1024"
                else:
                    smaller = "1536x1024" if w / max(h, 1) > 1.15 else "1024x1024"
            except Exception:
                smaller = "1152x1536"
        else:
            smaller = "1152x1536"
        options.append(
            {
                "label": "保持最高质量，降低尺寸重试",
                "reason": "不降低 quality，只减少像素量，通常能避开网关超时。",
                "arguments": {
                    "prompt": prompt,
                    "size": smaller,
                    "quality": quality or "high",
                    "n": _safe_int(n, 1, min_value=1, max_value=2),
                },
            }
        )
    options.append(
        {
            "label": "保持参数，直接重试",
            "reason": "适合 502/524/队列波动等临时失败。",
            "arguments": {"prompt": prompt, "size": size, "quality": quality or "high", "n": _safe_int(n, 1, min_value=1, max_value=2)},
        }
    )
    simplified = re.sub(r"[，,。；;、]\\s*", "，", prompt or "")[:420]
    if simplified and simplified != prompt:
        options.append(
            {
                "label": "简化提示词重试",
                "reason": "不降低画质，只减少复杂中文密集排版和约束数量。",
                "arguments": {"prompt": simplified, "size": size, "quality": quality or "high", "n": n},
            }
        )
    options.append(
        {
            "label": "速度优先可选",
            "reason": "仅在你接受速度优先时手动使用；系统不会自动降低画质。",
            "arguments": {"prompt": prompt, "size": size, "quality": "auto", "n": n},
        }
    )
    return options[:4]


async def _await_with_progress(
    awaitable: Awaitable[Any],
    *,
    label: str,
    step: str,
    heartbeat_seconds: float = 20.0,
    timeout_hint_seconds: int = 480,
    data: Optional[Dict[str, Any]] = None,
) -> Any:
    """Await a long-running operation while emitting ChatGPT-like heartbeat progress."""
    start = time.perf_counter()
    task = asyncio.create_task(awaitable)
    meta = dict(data or {})
    try:
        while True:
            try:
                return await asyncio.wait_for(asyncio.shield(task), timeout=heartbeat_seconds)
            except asyncio.TimeoutError:
                elapsed = _elapsed_ms(start)
                emit_tool_progress(
                    f"{label}仍在进行，已等待 {_fmt_elapsed(elapsed)}（最长约 {timeout_hint_seconds // 60} 分钟）",
                    step=f"{step}_waiting",
                    data={**meta, "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 1)},
                )
    except asyncio.CancelledError:
        task.cancel()
        raise


# ---------- helpers ----------

async def _get_article(article_id: int) -> Optional[Article]:
    async with SessionLocal() as s:
        return await s.get(Article, article_id)


async def _get_article_for_user(article_id: int) -> tuple[Optional[Article], Optional[str]]:
    """Fetch an article and enforce current tool user ownership when present."""
    art = await _get_article(article_id)
    if not art:
        return None, f"article {article_id} not found"
    uid = get_tool_user_id()
    if uid is not None and art.user_id != uid:
        return art, "无权访问该笔记"
    return art, None


async def _ensure_article_access(article_id: Optional[int]) -> Optional[Dict[str, Any]]:
    if not article_id:
        return None
    _, err = await _get_article_for_user(int(article_id))
    if err:
        return {"ok": False, "error": err}
    return None


async def _ensure_article_image_access(
    article_id: Optional[int],
    image_url: str,
) -> Optional[Dict[str, Any]]:
    """When editing in-place, ensure the source image belongs to the target article."""
    if not article_id:
        return None
    art, err = await _get_article_for_user(int(article_id))
    if err:
        return {"ok": False, "error": err}
    assert art is not None
    allowed = {
        _canonicalize_app_image_ref(x)
        for x in [art.cover_image, *(art.images or [])]
        if str(x or "").strip()
    }
    if _canonicalize_app_image_ref(image_url) not in allowed:
        return {"ok": False, "error": "图片不属于该笔记"}
    return None


async def _snapshot_article(article_id: int, trigger: str = "auto") -> None:
    """Save a version snapshot before destructive operations."""
    async with SessionLocal() as s:
        a = await s.get(Article, article_id)
        if not a:
            return
        last = await s.execute(
            select(ArticleVersion)
            .where(ArticleVersion.article_id == article_id)
            .order_by(ArticleVersion.version.desc())
            .limit(1)
        )
        last_v = last.scalars().first()
        next_ver = (last_v.version + 1) if last_v else 1
        v = ArticleVersion(
            article_id=article_id,
            user_id=a.user_id,
            version=next_ver,
            title=a.title,
            body=a.body,
            tags=a.tags,
            cover_image=a.cover_image,
            images=a.images or [],
            trigger=trigger,
        )
        s.add(v)
        await s.commit()


def _safe_json(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        lowered = text.lower()
        if lowered.startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    # try to pull the largest {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return {}
    # fallback: array
    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1 and end > start:
        try:
            return {"items": json.loads(text[start : end + 1])}
        except Exception:
            return {}
    return {}


def _configured_public_base_url() -> str:
    settings = get_current_settings() or get_settings()
    base = (getattr(settings, "public_base_url", "") or "").strip().rstrip("/")
    if not base:
        return ""
    try:
        parsed = urlparse(base)
        if parsed.scheme.lower() in {"http", "https"} and parsed.netloc:
            return base
    except Exception:
        pass
    return ""


def _absolute_image_url(url_or_path: str) -> str:
    """Best user/agent-facing absolute URL for an image.

    Storage keeps app images as /static/images/... so local edits stay portable.
    For model/Agent context we additionally expose an absolute public URL when
    PUBLIC_BASE_URL is configured.  Public external URLs are already complete.
    """
    value = str(url_or_path or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        return value
    base = _configured_public_base_url()
    if base and value.startswith("/static/images/"):
        return urljoin(base + "/", value.lstrip("/"))
    return value


def _image_url_fields(url_or_path: str) -> Dict[str, Any]:
    value = str(url_or_path or "").strip()
    full = _absolute_image_url(value)
    fields: Dict[str, Any] = {
        "url": value,
        "full_url": full,
        # Explicit aliases for model/tool readers.  `url` stays as the stored
        # app path; `model_url` is the best URL to show/pass to an upstream.
        "model_url": full,
    }
    if value != full:
        fields["stored_url"] = value
        fields["public_url"] = full
    if value.startswith("/static/images/") and not _configured_public_base_url():
        fields["public_url_configured"] = False
        fields["url_note"] = "本地静态图片路径；如需外部模型直接读取，请在设置页配置 PUBLIC_BASE_URL。"
    return fields


def _canonicalize_app_image_ref(url_or_path: str) -> str:
    """Convert this app's public/static image URL back to portable storage form."""
    value = str(url_or_path or "").strip()
    if not value:
        return ""
    if value.startswith("/static/images/"):
        return value
    if not (value.startswith("http://") or value.startswith("https://")):
        return value
    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if parsed.path.startswith("/static/images/") and host in {"localhost", "127.0.0.1", "::1"}:
            return parsed.path
        base = _configured_public_base_url()
        if base:
            b = urlparse(base)
            base_path = b.path.rstrip("/")
            expected = f"{base_path}/static/images/" if base_path else "/static/images/"
            if (
                parsed.scheme.lower() == b.scheme.lower()
                and parsed.netloc.lower() == b.netloc.lower()
                and parsed.path.startswith(expected)
            ):
                rel = parsed.path[len(expected):].lstrip("/")
                return f"/static/images/{rel}" if rel else value
    except Exception:
        pass
    return value


def _static_image_path(url_or_path: str) -> Optional[Path]:
    """Resolve an app image URL/path to disk, returning None if not local/safe."""
    if not url_or_path:
        return None
    try:
        base = Path(get_settings().image_dir).resolve()
        s = _canonicalize_app_image_ref(str(url_or_path))
        path_part = s
        if s.startswith("http://") or s.startswith("https://"):
            parsed = urlparse(s)
            host = (parsed.hostname or "").lower()
            if host not in {"localhost", "127.0.0.1", "::1"} and not host.endswith(".local"):
                return None
            path_part = parsed.path
        if path_part.startswith("/static/images/"):
            rel = path_part[len("/static/images/"):].lstrip("/")
            candidate = (base / rel).resolve()
        else:
            p = Path(s)
            candidate = p.resolve() if p.is_absolute() else (base / p.name).resolve()
        if not candidate.is_relative_to(base):
            return None
        return candidate
    except Exception:
        return None


def _image_asset(url: str, role: str, index: Optional[int] = None) -> Dict[str, Any]:
    """Return lightweight image metadata for agent reasoning without embedding bytes."""
    item: Dict[str, Any] = {"role": role, **_image_url_fields(url)}
    if index is not None:
        item["index"] = index
    path = _static_image_path(url)
    if path and path.exists():
        item["exists"] = True
        try:
            item["bytes"] = path.stat().st_size
        except Exception:
            pass
        try:
            from PIL import Image

            with Image.open(path) as im:
                item["width"], item["height"] = im.size
                item["format"] = im.format
        except Exception:
            pass
    elif path:
        item["exists"] = False
    return item


def _article_image_context(art: Article) -> Dict[str, Any]:
    stored_cover = (art.cover_image or "").strip()
    raw_content_images = [str(x).strip() for x in (art.images or []) if str(x or "").strip()]
    # 小红书没有“封面图”和“内容图”的强边界：展示队列的第 1 张就是首图/封面。
    # 兼容旧数据：如果 DB 里 cover_image 为空但 images 有图，也把 images[0] 视为有效首图。
    queue = _dedupe_preserve_order(([stored_cover] if stored_cover else []) + raw_content_images)
    cover = queue[0] if queue else ""
    content_images = queue[1:] if len(queue) > 1 else []
    assets: List[Dict[str, Any]] = []
    if cover:
        assets.append(_image_asset(cover, "cover"))
    for i, url in enumerate(content_images):
        assets.append(_image_asset(url, "content", i))
    visual_images: List[Dict[str, Any]] = []
    for position, item in enumerate(assets):
        visual_item = {
            "position": position,
            "role": item.get("role"),
            "url": item.get("url"),
            "full_url": item.get("full_url") or item.get("url"),
            "model_url": item.get("model_url") or item.get("url"),
        }
        if item.get("public_url"):
            visual_item["public_url"] = item["public_url"]
        if item.get("stored_url"):
            visual_item["stored_url"] = item["stored_url"]
        if "index" in item:
            visual_item["index"] = item["index"]
        visual_images.append(visual_item)
    return {
        "has_cover": bool(cover),
        "stored_has_cover": bool(stored_cover),
        "cover_image": cover,
        "cover_image_full_url": _absolute_image_url(cover) if cover else "",
        "content_images": [
            {"index": i, **_image_url_fields(url)}
            for i, url in enumerate(content_images)
        ],
        # 小红书真实展示语义：所有图片是一个队列，position=0 即首图/封面。
        "visual_images": visual_images,
        "all_images": assets,
        "image_count": len(assets),
        "content_image_count": len(content_images),
        "visual_queue": queue,
        "visual_queue_full_urls": [_absolute_image_url(url) for url in queue],
        "notes": (
            "visual_images 按展示顺序排列，position=0 是首图/封面；"
            "content_images 按 index 从 0 开始，对应 visual position=index+1；"
            "如果历史数据没有单独 cover_image，系统会自动把第一张图片视为首图/封面。"
            "需要移动、设为首图、插入或重排时优先使用 arrange_article_images。"
        ),
    }


def _article_payload(art: Article) -> Dict[str, Any]:
    payload = art.to_dict()
    payload["image_context"] = _article_image_context(art)
    # 对外统一暴露“小红书展示队列”语义：cover_image 永远是有效首图；
    # images 只包含首图之后的后续内容图，避免前端/Agent 再次判断旧数据形态。
    payload["cover_image"] = payload["image_context"]["cover_image"]
    payload["images"] = [x["url"] for x in payload["image_context"]["content_images"]]
    payload["cover_image_full_url"] = payload["image_context"].get("cover_image_full_url") or payload["cover_image"]
    payload["images_full_urls"] = [x.get("full_url") or x.get("url") for x in payload["image_context"]["content_images"]]
    fallback_queue = [x for x in [payload["cover_image"], *payload["images"]] if x]
    fallback_queue_full = [x for x in [payload["cover_image_full_url"], *payload["images_full_urls"]] if x]
    payload["visual_queue"] = payload["image_context"].get("visual_queue") or fallback_queue
    payload["visual_queue_full_urls"] = payload["image_context"].get("visual_queue_full_urls") or fallback_queue_full
    payload["content_stats"] = {
        "title_chars": len(art.title or ""),
        "body_chars": len(art.body or ""),
        "tag_count": len(payload.get("tags") or []),
        "image_count": payload["image_context"]["image_count"],
    }
    return payload


def _article_image_summary_text(art: Article) -> str:
    ctx = _article_image_context(art)
    lines = [
        f"图片总数：{ctx['image_count']}（首图/封面：{'有' if ctx['has_cover'] else '无'}，后续内容图：{ctx['content_image_count']}）"
    ]
    assets_by_key: Dict[tuple, Dict[str, Any]] = {
        (item.get("role"), item.get("index")): item
        for item in ctx.get("all_images", [])
    }

    def meta_text(asset: Optional[Dict[str, Any]]) -> str:
        if not asset:
            return ""
        parts: List[str] = []
        if asset.get("width") and asset.get("height"):
            parts.append(f"{asset['width']}x{asset['height']}")
        if asset.get("format"):
            parts.append(str(asset["format"]))
        if asset.get("bytes"):
            try:
                parts.append(f"{int(asset['bytes']) / 1024 / 1024:.1f}MB")
            except Exception:
                pass
        if asset.get("exists") is False:
            parts.append("文件未找到")
        return f"（{ '，'.join(parts) }）" if parts else ""

    if ctx["cover_image"]:
        full = ctx.get("cover_image_full_url") or ctx["cover_image"]
        suffix = f"（完整URL：{full}）" if full != ctx["cover_image"] else ""
        lines.append(f"首图/封面：{ctx['cover_image']}{suffix}{meta_text(assets_by_key.get(('cover', None)))}")
    for img in ctx["content_images"][:12]:
        asset = assets_by_key.get(("content", img["index"]))
        full = img.get("full_url") or img.get("url")
        suffix = f"（完整URL：{full}）" if full != img.get("url") else ""
        lines.append(f"后续内容图[{img['index']}]：{img['url']}{suffix}{meta_text(asset)}")
    if ctx["content_image_count"] > 12:
        lines.append(f"其余内容图：{ctx['content_image_count'] - 12} 张未展开")
    return "\n".join(lines)


def _article_prompt_context(art: Article, *, body_limit: int = 8000) -> str:
    body = art.body or ""
    if len(body) > body_limit:
        body = body[: body_limit - 1] + "…"
    tags = " ".join([t for t in (art.tags or "").split(",") if t.strip()]) or "（无）"
    return (
        f"笔记ID：{art.id}\n"
        f"标题：{art.title or ''}\n"
        f"状态：{art.status or ''}\n"
        f"标签：{tags}\n"
        f"{_article_image_summary_text(art)}\n"
        f"正文：\n{body}"
    )


XHS_WRITER_SYSTEM = (
    "你是小红书爆款内容创作专家，精通平台话术、用户心理和流量机制。"
    "你的文风像跟闺蜜聊天——真诚、有温度、口语化，但信息密度高。\n\n"
    "【原创创作原则】\n"
    "- 原创不是把主题扩写成通用模板，而是从用户给的素材里提炼真实卖点、使用场景、情绪价值和可验证细节\n"
    "- 如果有房源信息/产品信息/服务信息/用户评价/房客评价，必须把素材拆成：硬信息、体验证据、目标人群、痛点解决、避坑提醒，再写成小红书口吻\n"
    "- 民宿/酒店/房源类要重点写：位置与交通、景观/空间、适合谁、入住体验、周边玩法、房客评价里反复出现的亮点；不要空喊“绝美/高级/宝藏”\n"
    "- 每 2-3 段至少落一个具体细节；不能从素材推出的事实不要编造，可用“更适合/比较适合/建议提前确认”这类稳妥表达\n\n"
    "【改写原则】\n"
    "- 改写不是缩写，也不是逐句同义替换；要先保留事实，再重构标题钩子、开头视角、段落顺序、表达节奏和互动结尾\n"
    "- 降低与原帖的连续文本和关键词重复：避免连续 12 个字以上照搬；高频关键词要换成场景化表达、用户语言或长尾搜索词\n"
    "- 原帖里的核心信息、房源/产品事实、图片匹配关系要保留，但表达要像一篇新的可发布笔记\n\n"
    "【标题规范】≤20字，必须含 1-2 个搜索关键词。公式参考：\n"
    "- 数字冲击：「5 个动作瘦腰 8cm」\n"
    "- 痛点共鸣：「熬夜党必看！急救暗沉只要 3 步」\n"
    "- 悬念好奇：「后悔没早知道的 XX」\n"
    "- 反差对比：「月薪 3k 住出 3w 的感觉」\n"
    "emoji ≤2 个，放在标题末尾或关键词旁。\n\n"
    "【正文规范】\n"
    "- 首句强钩子：制造共鸣/好奇/痛点，让人想继续读\n"
    "- 段落节奏：短句为主（≤15字），长短交替，每 2-3 句换行留白\n"
    "- 善用 emoji 做视觉锚点和段落分隔，但不堆砌（每段 1-3 个）\n"
    "- 信息点清晰：一段一个核心观点，用「」或加粗强调关键词\n"
    "- 结尾引导互动：提问/求分享/投票，制造评论欲\n\n"
    "【标签策略】附 5-10 个标签（带 # 前缀）：\n"
    "- 前 2 个放大流量词（搜索量大的品类词）\n"
    "- 中间放精准长尾词（细分场景/人群）\n"
    "- 最后放热点词或情绪词\n\n"
    '严格按 JSON 返回：{"title":"...","body":"...","tags":["#tag1","#tag2"]}'
)


XHS_WORKFLOW_SYSTEM = (
    "你是小红书端到端内容工作流总监。你不是只写一篇文案，而是要一次性交付"
    "选题定位、标题、正文、标签、首图方向、后续内容图方向和自检结论。\n\n"
    "如果 brief 包含房源信息、房客评价、商品评价或原始素材，必须先做素材提炼："
    "把真实信息转成小红书用户关心的场景、痛点、证据和种草理由；不要产出泛泛的模板文。\n"
    "如果任务是改写/仿写，要重构表达而不是压缩原文，避免原帖关键词和句式高度重合。\n\n"
    "输出必须能直接进入草稿箱：标题≤20字，正文口语化、分段清晰、结尾有互动引导，"
    "标签 5-10 个，可带 #；系统入库时会统一规范为单个 # 展示。\n"
    "避免广告法绝对化、医疗承诺、收益承诺和站外引流表达。\n\n"
    "严格按 JSON 返回，不要包 markdown：\n"
    "{"
    '"strategy":{"positioning":"定位","audience":"人群","hook_angle":"钩子角度","selling_points":["卖点"]},'
    '"title":"主标题",'
    '"title_candidates":["备选标题1","备选标题2","备选标题3","备选标题4","备选标题5","备选标题6"],'
    '"body":"完整正文",'
    '"tags":["#标签1","#标签2"],'
    '"cover_prompt":{"prompt":"中文首图/封面生成提示词","size":"1152x1536","quality":"high"},'
    '"content_image_prompts":[{"scene":"场景名","prompt":"中文配图提示词","size":"1152x1536","quality":"high"}],'
    '"self_check":{"strengths":["亮点"],"risks":["风险"],"next_actions":["下一步建议"]}'
    "}"
)


XHS_CATEGORY_PLAYBOOKS: Dict[str, Dict[str, str]] = {
    "travel": {
        "title": "旅游/攻略",
        "writing": "路线要按天/区域写，必须包含交通、预算/时间、避坑、拍照机位；民宿/酒店/房源要从位置、景观、房型、入住体验、房客评价和周边玩法提炼种草点，正文适合收藏转发。",
        "title_formula": "地名 + 天数/人均/避坑/路线/住宿体验，例如「威海海景民宿怎么选」。",
        "visual": "首图优先地图感信息图/地标拼贴/路线卡片；民宿房源适合窗景、房间细节、周边路线、评价亮点卡片。",
    },
    "food": {
        "title": "美食/食谱",
        "writing": "突出一口感受、做法步骤、食材替换和失败避坑；语气要有食欲和烟火气。",
        "title_formula": "强情绪 + 食物名 + 结果，如「这个拌面香迷糊了」。",
        "visual": "首图要近景、有油润光泽/拉丝/热气，步骤图清楚。",
    },
    "beauty": {
        "title": "美妆/护肤",
        "writing": "强调肤质/场景/使用感，避免医疗承诺；用「改善观感/提亮/维稳」替代绝对功效。",
        "title_formula": "人群/肤质 + 痛点 + 体验结果，如「油皮夏天这样维稳」。",
        "visual": "首图适合产品质感平铺、上脸/手臂试色、before-after 但避免夸张承诺。",
    },
    "fashion": {
        "title": "穿搭/时尚",
        "writing": "写清身高体重/场景/单品公式/显高显瘦点，给可复制搭配。",
        "title_formula": "场景 + 风格 + 身材收益，如「小个子通勤这样穿」。",
        "visual": "首图要完整 outfit、色系统一、留白干净；可加单品编号。",
    },
    "home": {
        "title": "家居/收纳",
        "writing": "突出面积、预算、前后对比、收纳逻辑和购买/改造清单。",
        "title_formula": "空间痛点 + 预算/面积 + 改造结果，如「38㎡住出80㎡」。",
        "visual": "首图适合 before-after、空间全景、清单式编号。",
    },
    "tech": {
        "title": "科技/效率",
        "writing": "先给结论，再写适合谁/不适合谁/核心参数/真实体验，避免堆术语。",
        "title_formula": "产品/工具 + 结论/场景，如「一篇看懂这款AI工具」。",
        "visual": "首图适合产品界面截图、功能对比表、参数卡片。",
    },
    "fitness": {
        "title": "健身/身材管理",
        "writing": "强调动作、频率、适合人群和注意事项；避免绝对减重承诺。",
        "title_formula": "时间/动作数 + 目标部位 + 体验，如「每天10分钟练背」。",
        "visual": "首图适合动作分解、计划表、打卡模板。",
    },
    "lifestyle": {
        "title": "生活/经验",
        "writing": "强调共鸣、具体场景和可执行清单；少空话，多真实细节。",
        "title_formula": "情绪/身份 + 具体收获，如「打工人周末回血清单」。",
        "visual": "首图适合手账清单、生活场景、情绪氛围图。",
    },
}


def _category_playbook_text(category: str) -> str:
    from .research_data import CATEGORY_CN, MODEL_PARAMS, VIRAL_TITLES

    cat = category if category in XHS_CATEGORY_PLAYBOOKS else "lifestyle"
    p = XHS_CATEGORY_PLAYBOOKS[cat]
    model = MODEL_PARAMS.get(cat, MODEL_PARAMS["lifestyle"])
    viral = VIRAL_TITLES.get(cat, [])[:3]
    return (
        f"【赛道写作模板：{CATEGORY_CN.get(cat, p['title'])}】\n"
        f"- 写作重点：{p['writing']}\n"
        f"- 标题公式：{p['title_formula']}\n"
        f"- 首图/配图：{p['visual']}\n"
        f"- 数据建议：标题 {model['title_length']['min']}-{model['title_length']['max']} 字；"
        f"标签 {model['tag_count']['min']}-{model['tag_count']['max']} 个；"
        f"图片 {model['image_count']['min']}-{model['image_count']['max']} 张。\n"
        f"- 爆款标题参考：{' / '.join(viral)}"
    )


def _stringify_material(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    try:
        return json.dumps(value, ensure_ascii=False, indent=2)
    except Exception:
        return str(value).strip()


def _collect_creation_material(args: Dict[str, Any]) -> str:
    """Collect structured source material without forcing the model into generic copy.

    Agents may pass listing_info / guest_reviews separately, or put everything
    into extra.  We keep clear section labels so the writer can distinguish hard
    facts from subjective reviews and turn them into XHS-style evidence.
    """
    blocks: List[str] = []
    for key, label in (
        ("source_material", "原始素材"),
        ("listing_info", "房源/产品信息"),
        ("guest_reviews", "用户/房客评价"),
        ("extra", "补充要求"),
    ):
        text = _stringify_material(args.get(key))
        if text:
            blocks.append(f"【{label}】\n{text}")
    return "\n\n".join(blocks)


def _normalize_title(value: Any, fallback: str = "", *, limit: int = 20) -> str:
    """Normalize article titles to the product contract used by the editor."""
    title = str(value if value is not None else fallback or "").strip()
    if not title:
        title = str(fallback or "").strip()
    return title[:limit]


def _normalize_tags(tags: Any, limit: int = 10) -> List[str]:
    if isinstance(tags, str):
        candidates: List[Any] = [x for x in re.split(r"[,，\s]+", tags) if x]
    elif isinstance(tags, list):
        candidates = tags
    else:
        return []
    out: List[str] = []
    seen = set()
    for raw in candidates:
        t = str(raw or "").strip().lstrip("#＃").strip()
        if not t:
            continue
        key = t.lower()
        if key not in seen:
            out.append(t)
            seen.add(key)
        if len(out) >= limit:
            break
    return out


_DEFAULT_IMAGE_SIZE = "1152x1536"  # 1.5K long side, default 3:4 portrait.
_OLD_DEFAULT_IMAGE_SIZES = {"1024x1536", "1024x1024", _DEFAULT_IMAGE_SIZE}
_COMMON_IMAGE_RATIOS: Dict[str, tuple[int, int]] = {
    "1:1": (1, 1),
    "3:4": (3, 4),
    "4:3": (4, 3),
    "2:3": (2, 3),
    "3:2": (3, 2),
    "9:16": (9, 16),
    "16:9": (16, 9),
}


def _round_to_multiple(value: float, base: int = 64) -> int:
    return max(base, int(round(value / base) * base))


def _image_ratio_from_text(text: str) -> tuple[int, int]:
    value = str(text or "").lower()
    for m in re.finditer(r"(?<!\d)(1|2|3|4|9|16)\s*[:：]\s*(1|2|3|4|9|16)(?!\d)", value):
        key = f"{int(m.group(1))}:{int(m.group(2))}"
        if key in _COMMON_IMAGE_RATIOS:
            return _COMMON_IMAGE_RATIOS[key]
    if any(x in value for x in ("横版", "横图", "landscape", "宽屏")):
        return (16, 9)
    if any(x in value for x in ("方图", "正方形", "square")):
        return (1, 1)
    # 小红书默认竖版图文更常用 3:4；用户明确指定比例时再覆盖。
    return (3, 4)


def _image_long_side_from_text(text: str) -> int:
    value = str(text or "").lower().replace("２", "2").replace("４", "4")
    # Prefer explicit 4K/2K/1.5K wording over generic dimensions.
    if re.search(r"(?<!\d)4\s*k\b|4k|4\s*Ｋ|4\s*千", value, re.I):
        return 4096
    if re.search(r"(?<!\d)2\s*k\b|2k|2\s*Ｋ|2\s*千", value, re.I):
        return 2048
    if re.search(r"1[.．]5\s*k|1[.．]5\s*千|1536", value, re.I):
        return 1536
    return 1536


def _explicit_size_from_text(text: str) -> Optional[str]:
    m = re.search(r"(?<!\d)(\d{3,5})\s*[x×]\s*(\d{3,5})(?!\d)", str(text or ""), re.I)
    if not m:
        return None
    w, h = int(m.group(1)), int(m.group(2))
    if 64 <= w <= 4096 and 64 <= h <= 4096 and w * h <= 4096 * 4096:
        return f"{w}x{h}"
    return None


def _size_from_long_side_and_ratio(long_side: int, ratio: tuple[int, int]) -> str:
    rw, rh = ratio
    long_side = max(64, min(4096, int(long_side or 1536)))
    if rw >= rh:
        w = long_side
        h = _round_to_multiple(long_side * rh / rw)
    else:
        h = long_side
        w = _round_to_multiple(long_side * rw / rh)
    w = max(64, min(4096, w))
    h = max(64, min(4096, h))
    return f"{w}x{h}"


def _infer_image_size_from_request(
    text: str,
    requested_size: Any = None,
    *,
    default_size: str = _DEFAULT_IMAGE_SIZE,
) -> str:
    """Respect user-requested resolution/ratio even if the LLM omitted size.

    Examples:
    - "2K 3:4 竖版" -> 1536x2048
    - "4K 16:9 横版" -> 4096x2304
    - "2048x1152" -> 2048x1152
    """
    raw_size = str(requested_size or "").strip().lower()
    has_user_size_hint = bool(
        re.search(r"\d{3,5}\s*[x×]\s*\d{3,5}|(?<!\d)(1[.．]5|2|4)\s*k\b|[124]\s*Ｋ|分辨率|清晰度", str(text or ""), re.I)
    )
    has_ratio_hint = bool(
        re.search(r"(?<!\d)(1|2|3|4|9|16)\s*[:：]\s*(1|2|3|4|9|16)(?!\d)|横版|横图|竖版|竖图|方图|正方形", str(text or ""), re.I)
    )
    explicit = _explicit_size_from_text(text)
    if explicit and (not raw_size or raw_size in _OLD_DEFAULT_IMAGE_SIZES):
        return explicit
    if raw_size and raw_size not in _OLD_DEFAULT_IMAGE_SIZES and re.match(r"^\d{2,5}x\d{2,5}$", raw_size):
        return raw_size
    if has_user_size_hint or has_ratio_hint or not raw_size:
        return _size_from_long_side_and_ratio(
            _image_long_side_from_text(text),
            _image_ratio_from_text(text),
        )
    if raw_size in _OLD_DEFAULT_IMAGE_SIZES:
        return default_size
    return raw_size or default_size


def _normalize_shots(shots: Any, limit: int = 4) -> List[Dict[str, str]]:
    if not isinstance(shots, list):
        return []
    out: List[Dict[str, str]] = []
    for item in shots[:limit]:
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        out.append(
            {
                "scene": str(item.get("scene") or f"配图{len(out) + 1}"),
                "prompt": prompt,
                "size": str(item.get("size") or _DEFAULT_IMAGE_SIZE),
                "quality": str(item.get("quality") or "high"),
            }
        )
    return out


def _series_visual_style(title: str = "", category: str = "", style: str = "") -> str:
    """Create a deterministic visual anchor so batch images do not drift apart."""
    cat = category or "lifestyle"
    base = style or "小红书 3:4 竖版，清爽高级，统一色调，画面清晰，细节丰富"
    by_cat = {
        "travel": "旅行攻略信息图/手账风，统一地图线条、小图标、地标插画、路线编号和留白节奏",
        "food": "美食图文风，统一自然暖光、近景质感、餐具与桌面材质，突出食欲和步骤清晰度",
        "beauty": "美妆护肤种草风，统一柔和棚拍光、干净背景、产品质感和安全留白",
        "fashion": "穿搭杂志风，统一背景、人物比例、色系和单品编号，强调可复制搭配",
        "home": "家居收纳风，统一空间光线、前后对比卡片、编号标签和整洁秩序感",
        "tech": "效率工具信息图风，统一深浅对比、界面卡片、参数标签和现代科技感",
        "fitness": "健身打卡风，统一动作分解、计划表标签、清晰姿势和健康阳光感",
        "lifestyle": "生活方式手账风，统一奶油色背景、便签贴纸、柔和自然光和松弛感",
    }
    topic = f"主题《{title}》" if title else "同一主题"
    return (
        f"{topic}整组视觉统一：{base}；{by_cat.get(cat, by_cat['lifestyle'])}；"
        "所有图片保持相同配色、字体/贴纸风格、构图密度、光影和质感，像同一篇小红书笔记的一组连续内容图。"
    )


def _build_image_storyboard(
    shots: List[Dict[str, str]],
    *,
    title: str = "",
    category: str = "",
    style: str = "",
    size_hint_text: str = "",
    default_size: str = _DEFAULT_IMAGE_SIZE,
    default_quality: str = "high",
) -> Dict[str, Any]:
    """Normalize shots and append a shared visual anchor for coherent batch generation."""
    series_style = _series_visual_style(title=title, category=category, style=style)
    storyboard: List[Dict[str, Any]] = []
    total = len(shots)
    for idx, shot in enumerate(shots):
        role = "首图候选" if idx == 0 else "内容图"
        scene = str(shot.get("scene") or f"配图{idx + 1}").strip()
        raw_prompt = str(shot.get("prompt") or "").strip()
        narrative = f"第 {idx + 1}/{total} 张，作用：{role}，场景：{scene}。"
        prompt = raw_prompt
        if series_style not in prompt:
            prompt = f"{raw_prompt}\n\n{narrative}\n{series_style}".strip()
        size = _infer_image_size_from_request(
            f"{size_hint_text} {scene} {raw_prompt}",
            shot.get("size") or default_size,
        )
        quality = str(shot.get("quality") or default_quality or "high")
        storyboard.append(
            {
                "index": idx,
                "role": role,
                "scene": scene,
                "prompt": prompt,
                "size": size,
                "quality": quality,
                "series_style": series_style,
            }
        )
    return {"series_style": series_style, "shots": storyboard}


def _fallback_storyboard_shots(title: str, body: str, n: int = 4) -> List[Dict[str, str]]:
    """Deterministic fallback when the LLM omits image prompts."""
    text = str(body or "").strip()
    lines = [x.strip(" -•\t") for x in re.split(r"[\n。！？!?]+", text) if x.strip()]
    anchors = lines[: max(1, n)] or [str(title or "小红书笔记")]
    shots: List[Dict[str, str]] = []
    for idx in range(max(1, n)):
        anchor = anchors[idx % len(anchors)]
        scene = f"内容分镜 {idx + 1}"
        shots.append(
            {
                "scene": scene,
                "prompt": (
                    f"围绕《{title or '小红书笔记'}》的第 {idx + 1} 个核心信息点设计配图：{anchor}。"
                    "小红书信息图/手账感排版，主体清晰，信息层级明确，画面干净，适合图文笔记连续阅读。"
                ),
                "size": _DEFAULT_IMAGE_SIZE,
                "quality": "high",
            }
        )
    return shots[:n]


def _article_quick_check(
    title: str,
    body: str,
    tags: List[str],
    image_count: int = 0,
) -> Dict[str, Any]:
    """Deterministic local verifier used by workflow tools before/after LLM calls."""
    from .banned_words import check_banned_words
    from .research_data import CATEGORY_CN, detect_category
    from .text_analyzer import full_analysis

    category = detect_category(title, body, tags)
    analysis = full_analysis(title, body, category, tags, image_count)
    banned = check_banned_words(f"{title}\n{body}\n{' '.join(tags)}")
    issues = list(analysis.get("all_issues", []))
    if banned.hits:
        issues.extend([f"命中敏感词「{h.word}」（{h.category}）" for h in banned.hits[:8]])
    model_a = analysis.get("model_a_score", {})
    total_score = float(model_a.get("total_score") or 0)
    publish_ready = banned.safe and total_score >= 70 and len(tags) >= 4
    return {
        "category": category,
        "category_cn": CATEGORY_CN.get(category, category),
        "model_a_score": model_a,
        "text_analysis": analysis,
        "banned_words": banned.to_dict(),
        "issues": issues,
        "publish_ready": publish_ready,
    }


SCORE_KEYS = ("content", "visual", "growth", "engagement", "overall")


def _coerce_score_value(value: Any) -> Optional[int]:
    try:
        if value is None or isinstance(value, bool):
            return None
        n = float(value)
        if n != n:
            return None
        return int(round(max(0, min(100, n))))
    except Exception:
        return None


def _score_payload_from_quick_check(checks: Dict[str, Any]) -> Dict[str, Any]:
    """Convert the deterministic Model-A score into the app's five-dimension shape."""
    model_a = checks.get("model_a_score") or {}
    dims = model_a.get("dimensions") or {}

    def dim(key: str, default: int = 60) -> int:
        return _coerce_score_value(dims.get(key)) or default

    content = int(round(dim("title_quality") * 0.45 + dim("content_quality") * 0.55))
    visual = dim("visual_quality")
    growth = dim("tag_strategy")
    engagement = dim("engagement_potential")
    overall = _coerce_score_value(model_a.get("total_score"))
    if overall is None:
        overall = int(round((content + visual + growth + engagement) / 4))
    issues = [str(x) for x in (checks.get("issues") or []) if str(x).strip()]
    return {
        "content": content,
        "visual": visual,
        "growth": growth,
        "engagement": engagement,
        "overall": overall,
        "advice": issues[:5] or ["当前基础结构可用，可继续优化首图点击率、标签精准度和互动引导。"],
        "model": "local_model_a",
        "category": checks.get("category"),
        "category_cn": checks.get("category_cn"),
        "publish_ready": bool(checks.get("publish_ready")),
        "model_a_score": model_a,
    }


def _score_for_article(art: Article) -> Dict[str, Any]:
    tags = [t for t in (art.tags or "").split(",") if t.strip()]
    image_count = int(_article_image_context(art).get("image_count") or 0)
    checks = _article_quick_check(art.title or "", art.body or "", tags, image_count=image_count)
    return _score_payload_from_quick_check(checks)


def _normalize_score_payload(raw: Dict[str, Any], fallback: Dict[str, Any]) -> Dict[str, Any]:
    """Guarantee content/visual/growth/engagement/overall are present.

    Some compatible LLM gateways occasionally return only an overall score or a
    nested Model-A/diagnosis-like structure.  The UI radar and Agent follow-up
    need a stable five-dimension object, so we merge any valid LLM numbers onto
    the deterministic fallback instead of storing sparse score dicts.
    """
    data = raw if isinstance(raw, dict) else {}
    candidates: List[Dict[str, Any]] = [data]
    for key in ("radar_data", "score", "scores"):
        if isinstance(data.get(key), dict):
            candidates.append(data[key])

    # Also understand the internal Model-A dimension names.
    dimensions = data.get("dimensions")
    if not isinstance(dimensions, dict) and isinstance(data.get("model_a_score"), dict):
        dimensions = (data.get("model_a_score") or {}).get("dimensions")
    if isinstance(dimensions, dict):
        content_dim = None
        title_q = _coerce_score_value(dimensions.get("title_quality"))
        body_q = _coerce_score_value(dimensions.get("content_quality"))
        if title_q is not None and body_q is not None:
            content_dim = int(round(title_q * 0.45 + body_q * 0.55))
        mapped = {
            "content": content_dim,
            "visual": dimensions.get("visual_quality"),
            "growth": dimensions.get("tag_strategy"),
            "engagement": dimensions.get("engagement_potential"),
            "overall": data.get("total_score"),
        }
        candidates.append({k: v for k, v in mapped.items() if v is not None})

    aliases = {
        "content": ("content", "content_quality", "内容", "内容质量"),
        "visual": ("visual", "visual_quality", "视觉", "视觉吸引", "视觉表现"),
        "growth": ("growth", "growth_potential", "tag_strategy", "增长", "增长潜力"),
        "engagement": ("engagement", "interaction", "interaction_potential", "user_reaction", "互动", "互动潜力", "用户反应"),
        "overall": ("overall", "overall_score", "total", "total_score", "综合", "总分"),
    }

    out = dict(fallback)
    for key, names in aliases.items():
        value: Optional[int] = None
        for cand in candidates:
            for name in names:
                value = _coerce_score_value(cand.get(name))
                if value is not None:
                    break
            if value is not None:
                break
        if value is not None:
            out[key] = value

    if _coerce_score_value(out.get("overall")) is None:
        out["overall"] = int(round(sum(int(out[k]) for k in SCORE_KEYS[:-1]) / 4))

    advice = data.get("advice") or data.get("suggestions")
    if isinstance(advice, str):
        out["advice"] = [advice]
    elif isinstance(advice, list) and advice:
        out["advice"] = [str(x) for x in advice if str(x).strip()][:8]
    if data and data is not fallback:
        out["model"] = data.get("model") or "llm_score"
    return out


async def _refresh_article_local_score(article_id: int) -> Optional[Article]:
    """Recalculate local five-dimension score after image/title/body changes."""
    async with SessionLocal() as s:
        art = await s.get(Article, int(article_id))
        if not art:
            return None
        art.score = _score_for_article(art)
        await s.commit()
        await s.refresh(art)
        return art


# ---------- CRUD tools ----------

async def tool_create_article(args: Dict[str, Any]) -> Dict[str, Any]:
    title = _normalize_title(args.get("title", ""))
    body = args.get("body", "")
    tags = _normalize_tags(args.get("tags", []) or [])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


async def tool_update_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        if uid is not None and art.user_id != uid:
            return {"ok": False, "error": "无权操作该笔记"}
        for key in ("title", "body", "cover_image", "status"):
            if key in args and args[key] is not None:
                setattr(art, key, _normalize_title(args[key]) if key == "title" else args[key])
        if "tags" in args and args["tags"] is not None:
            art.tags = ",".join(_normalize_tags(args["tags"]))
        if "images" in args and args["images"] is not None:
            art.images = args["images"]
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


async def tool_read_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid is not None and art.user_id != uid:
        return {"ok": False, "error": "无权访问该笔记"}
    return {
        "ok": True,
        "article": _article_payload(art),
        "read_scope": "包含标题、正文、标签、状态、首图 cover_image、后续图片 images/image_context、评分和时间信息。",
    }


async def tool_list_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    limit = _safe_int(args.get("limit", 20), 20, min_value=1, max_value=100)
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        q = select(Article).order_by(Article.updated_at.desc()).limit(limit)
        if uid:
            q = q.where(Article.user_id == uid)
        res = await s.execute(q)
        items = [_article_payload(a) for a in res.scalars().all()]
        return {"ok": True, "items": items}


async def tool_delete_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        if uid is not None and art.user_id != uid:
            return {"ok": False, "error": "无权删除该笔记"}
        await s.delete(art)
        await s.commit()
        return {"ok": True}


# ---------- generation / rewrite / optimize ----------

async def tool_generate_article(args: Dict[str, Any]) -> Dict[str, Any]:
    topic = args.get("topic") or args.get("title") or ""
    if not topic:
        return {"ok": False, "error": "topic is required"}
    tone = args.get("tone", "真诚、有温度")
    length = args.get("length", "中等")
    audience = args.get("audience", "20-30岁女性")
    extra = _collect_creation_material(args)
    from .research_data import detect_category
    category = detect_category(str(topic), str(extra), [])
    playbook = _category_playbook_text(category)

    user_prompt = (
        f"主题：{topic}\n语气：{tone}\n长度：{length}\n目标受众：{audience}\n"
        f"素材与补充：\n{extra or '（无额外素材）'}\n\n"
        f"{playbook}\n"
        "请先在心里完成素材提炼：哪些是硬信息、哪些是评价证据、哪些能转成小红书种草点；"
        "正文必须有真实场景感和小红书口吻，避免像广告简介或通用 AI 文案。\n"
        "请按系统要求输出 JSON。"
    )
    resp = await chat_completion(
        messages=[
            {"role": "system", "content": XHS_WRITER_SYSTEM},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.9,
    )
    content = resp.choices[0].message.content or ""
    data = _safe_json(content)
    title = _normalize_title(data.get("title"), topic)
    body = data.get("body") or content
    tags = _normalize_tags(data.get("tags") or [])

    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


async def tool_create_complete_note_workflow(args: Dict[str, Any]) -> Dict[str, Any]:
    """Planner → Executor → Verifier workflow for a publish-ready XHS note.

    This high-level tool turns a brief into a complete draft with strategy,
    title candidates, tags, visual directions, local safety checks, and an
    optional one-pass self-improvement. It writes the final result to DB.
    """
    topic = (args.get("topic") or args.get("brief") or "").strip()
    if not topic:
        return {"ok": False, "error": "topic is required"}

    emit_tool_progress("已收到完整成稿需求，正在拆解 brief", step="workflow_start")
    audience = args.get("audience", "小红书主力用户")
    tone = args.get("tone", args.get("style", "真诚、有温度、有网感"))
    length = args.get("length", "中等")
    extra = _collect_creation_material(args)
    auto_optimize = bool(args.get("auto_optimize", True))
    include_visual_prompts = bool(args.get("include_visual_prompts", True))
    generate_cover = bool(args.get("generate_cover", False))
    generate_content_images = bool(args.get("generate_content_images", False))
    image_count = _safe_int(args.get("image_count", 4), 4, min_value=1, max_value=6)
    image_concurrency = _safe_int(args.get("image_concurrency", 3), 3, min_value=1, max_value=4)
    image_request_text = " ".join(
        str(x or "")
        for x in (
            topic,
            audience,
            tone,
            length,
            extra,
            args.get("image_size"),
            args.get("image_ratio"),
            args.get("size"),
            args.get("cover_size"),
        )
    )
    preferred_image_size = _infer_image_size_from_request(
        image_request_text,
        args.get("image_size") or args.get("size") or args.get("cover_size"),
    )
    from .research_data import detect_category
    category = detect_category(str(topic), str(extra), [])
    playbook = _category_playbook_text(category)

    plan_prompt = (
        f"创作主题/brief：{topic}\n"
        f"目标受众：{audience}\n"
        f"语气风格：{tone}\n"
        f"篇幅：{length}\n"
        f"素材与补充信息：\n{extra or '（无额外素材）'}\n\n"
        f"{playbook}\n"
        f"是否需要视觉方向：{include_visual_prompts}\n"
        f"图片规格：默认小红书 3:4 竖版，当前解析为 {preferred_image_size}；如果用户指定 2K/4K/16:9/1:1 等，必须按该规格输出所有图片 size。\n"
        "原创要求：如果素材里有房源信息/房客评价/用户反馈，必须用评价中的真实体验做证据，"
        "转成「谁适合、为什么值得住/买/去、有哪些注意点」的小红书表达，不要写成商家介绍。\n"
        "请一次性交付完整小红书笔记工作流结果。"
    )
    emit_tool_progress("正在规划内容策略、正文结构、标题候选和视觉方向", step="planning")
    resp = await chat_completion(
        messages=[
            {"role": "system", "content": XHS_WORKFLOW_SYSTEM},
            {"role": "user", "content": plan_prompt},
        ],
        temperature=0.85,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    emit_tool_progress("已完成初稿生成，正在整理标题、正文、标签和图片方向", step="draft_ready")

    title = _normalize_title(data.get("title"), topic)
    body = str(data.get("body") or "").strip()
    tags = _normalize_tags(data.get("tags") or [])
    title_candidates = [
        _normalize_title(x)
        for x in (data.get("title_candidates") or [])
        if _normalize_title(x)
    ][:8]
    if title and title not in title_candidates:
        title_candidates.insert(0, title)

    cover_prompt = data.get("cover_prompt") if isinstance(data.get("cover_prompt"), dict) else {}
    if not cover_prompt:
        cover_prompt = {
            "prompt": f"小红书封面，主题：{topic}，干净高级感，竖版 3:4，主体明确，预留标题区域",
            "size": preferred_image_size,
            "quality": "high",
        }
    cover_prompt["size"] = _infer_image_size_from_request(
        image_request_text + " " + str(cover_prompt.get("prompt") or ""),
        cover_prompt.get("size") or preferred_image_size,
    )
    content_shots = _normalize_shots(
        data.get("content_image_prompts") or data.get("shots") or [],
        limit=image_count,
    )
    if include_visual_prompts and not content_shots:
        content_shots = _fallback_storyboard_shots(title, body, image_count)
    image_storyboard = _build_image_storyboard(
        content_shots,
        title=title,
        category=category,
        style=str(args.get("image_style") or args.get("style") or tone),
        size_hint_text=image_request_text,
        default_size=preferred_image_size,
    )
    content_shots = image_storyboard["shots"]

    initial = {"title": title, "body": body, "tags": tags}
    emit_tool_progress("正在做本地发布前自检：标题长度、标签、敏感词、基础评分", step="self_check")
    checks_before = _article_quick_check(title, body, tags, image_count=0)
    optimization_applied = False
    changelog: List[str] = []

    should_optimize = auto_optimize and (
        len(title) > 20
        or len(tags) < 5
        or bool(checks_before["banned_words"].get("hits"))
        or float(checks_before["model_a_score"].get("total_score") or 0) < 75
    )

    if should_optimize:
        emit_tool_progress("发现可优化项，正在进行二次优化", step="auto_optimize")
        opt_prompt = (
            "请基于自检结果做一次最终优化，只返回 JSON。\n"
            "要求：标题≤20字，保留原主题；替换敏感/绝对化表达；补足标签；正文更有钩子和互动。\n\n"
            f"原始草稿：{json.dumps(initial, ensure_ascii=False)}\n"
            f"自检问题：{json.dumps(checks_before.get('issues', [])[:10], ensure_ascii=False)}\n"
            'JSON格式：{"title":"...","body":"...","tags":["#..."],"changelog":["..."]}'
        )
        opt_resp = await chat_completion(
            messages=[
                {"role": "system", "content": XHS_WRITER_SYSTEM},
                {"role": "user", "content": opt_prompt},
            ],
            temperature=0.65,
        )
        opt = _safe_json(opt_resp.choices[0].message.content or "")
        if opt:
            title = _normalize_title(opt.get("title"), title)
            body = str(opt.get("body") or body).strip()
            tags = _normalize_tags(opt.get("tags") or tags)
            changelog = [str(x) for x in (opt.get("changelog") or [])]
            optimization_applied = True
            if title and title not in title_candidates:
                title_candidates.insert(0, title)
        emit_tool_progress("二次优化完成，正在复检", step="optimize_done")
    else:
        emit_tool_progress("自检通过，无需二次优化", step="optimize_skipped")

    checks_after = _article_quick_check(title, body, tags, image_count=0)
    uid = get_tool_user_id()

    emit_tool_progress("正在写入草稿箱", step="saving")
    async with SessionLocal() as s:
        art = Article(
            title=title,
            body=body,
            tags=",".join(tags),
            status="draft",
            user_id=uid,
            score=_score_payload_from_quick_check(checks_after),
        )
        s.add(art)
        await s.commit()
        await s.refresh(art)
        article_id = art.id
    emit_tool_progress(f"已写入笔记 #{article_id}", step="saved", data={"article_id": article_id})

    generated_cover = ""
    generated_content_images: List[str] = []
    image_errors: List[Dict[str, Any]] = []
    if generate_cover:
        emit_tool_progress("正在生成展示队列第 1 张（首图）", step="generate_cover", data={"article_id": article_id})
        img_start = time.perf_counter()
        try:
            urls = await _await_with_progress(
                generate_image(
                    prompt=str(cover_prompt.get("prompt") or ""),
                    size=str(cover_prompt.get("size") or preferred_image_size),
                    quality=str(cover_prompt.get("quality") or "high"),
                    n=1,
                ),
                label="首图生成",
                step="generate_cover",
                data={"article_id": article_id, "role": "cover"},
            )
            generated_cover = urls[0] if urls else ""
            if generated_cover:
                await _bind_image_to_article(generated_cover, article_id, role="cover")
                emit_tool_progress(
                    f"首图已绑定到笔记展示队列第 1 位，用时 {_fmt_elapsed(_elapsed_ms(img_start))}",
                    step="cover_bound",
                    data={"article_id": article_id, "image": generated_cover, "elapsed_ms": _elapsed_ms(img_start)},
                )
        except Exception as e:
            elapsed = _elapsed_ms(img_start)
            msg = _friendly_tool_error(e, elapsed_ms=elapsed, action="首图生成")
            image_errors.append({"role": "cover", "error": msg, "elapsed_ms": elapsed})
            emit_tool_progress(msg, step="cover_failed", data={"article_id": article_id, "elapsed_ms": elapsed})

    if generate_content_images and content_shots:
        shots_to_generate = content_shots[:image_count]
        emit_tool_progress(
            f"将并发生成 {len(shots_to_generate)} 张后续队列图片（并发数 {image_concurrency}）",
            step="content_images_concurrent_start",
            data={"article_id": article_id, "count": len(shots_to_generate), "concurrency": image_concurrency},
        )
        sem = asyncio.Semaphore(image_concurrency)

        async def _generate_one_content_image(idx: int, shot: Dict[str, str]) -> Dict[str, Any]:
            async with sem:
                scene = shot.get("scene") or f"配图{idx + 1}"
                emit_tool_progress(
                    f"开始生成队列图片 {idx + 1}/{len(shots_to_generate)}：{scene}",
                    step="generate_content_image",
                    data={"article_id": article_id, "index": idx, "scene": scene},
                )
                img_start = time.perf_counter()
                try:
                    urls = await _await_with_progress(
                        generate_image(
                            prompt=shot["prompt"],
                            size=shot.get("size", preferred_image_size),
                            quality=shot.get("quality", "high"),
                            n=1,
                        ),
                        label=f"队列图片 {idx + 1}/{len(shots_to_generate)}",
                        step=f"generate_content_image_{idx}",
                        data={"article_id": article_id, "index": idx, "scene": scene},
                    )
                    url = urls[0] if urls else ""
                    elapsed = _elapsed_ms(img_start)
                    emit_tool_progress(
                        f"队列图片 {idx + 1} 生成完成，用时 {_fmt_elapsed(elapsed)}",
                        step="content_image_done",
                        data={"article_id": article_id, "index": idx, "scene": scene, "image": url, "elapsed_ms": elapsed},
                    )
                    return {"index": idx, "url": url, "elapsed_ms": elapsed}
                except Exception as e:
                    elapsed = _elapsed_ms(img_start)
                    msg = _friendly_tool_error(e, elapsed_ms=elapsed, action=f"队列图片 {idx + 1} 生成")
                    emit_tool_progress(
                        msg,
                        step="content_image_failed",
                        data={"article_id": article_id, "index": idx, "scene": scene, "elapsed_ms": elapsed},
                    )
                    return {"index": idx, "url": "", "error": msg, "elapsed_ms": elapsed}

        image_results = await asyncio.gather(
            *[_generate_one_content_image(idx, shot) for idx, shot in enumerate(shots_to_generate)]
        )
        for item in sorted(image_results, key=lambda x: int(x.get("index", 0))):
            if item.get("url"):
                generated_content_images.append(str(item["url"]))
            elif item.get("error"):
                image_errors.append({"role": "content", **item})
        if generated_content_images:
            async with SessionLocal() as s:
                art = await s.get(Article, article_id)
                if art:
                    queue = ([generated_cover] if generated_cover else []) + generated_content_images
                    _apply_article_visual_queue(art, queue)
                    await s.commit()
        if generated_content_images:
            emit_tool_progress(
                f"已生成并绑定 {len(generated_content_images)} 张图片；展示队列第 1 张即首图",
                step="content_images_bound",
                data={
                    "article_id": article_id,
                    "count": len(generated_content_images),
                    "first_image_is_cover": True,
                    "failed": len([x for x in image_errors if x.get("role") == "content"]),
                },
            )

    emit_tool_progress("工作流完成，正在整理返回结果", step="workflow_done", data={"article_id": article_id})
    final = await _refresh_article_local_score(article_id) or await _get_article(article_id)
    final_ctx = _article_image_context(final) if final else {}
    generated_cover = str(final_ctx.get("cover_image") or generated_cover or "")
    generated_content_images = [x["url"] for x in (final_ctx.get("content_images") or [])]
    return {
        "ok": True,
        "article": _article_payload(final) if final else {"id": article_id, "title": title, "body": body, "tags": tags},
        "workflow": {
            "strategy": data.get("strategy", {}),
            "title_candidates": title_candidates[:8],
            "cover_prompt": cover_prompt,
            "content_image_prompts": content_shots,
            "image_storyboard": image_storyboard,
            "self_check": data.get("self_check", {}),
            "checks_before": checks_before,
            "checks_after": checks_after,
            "optimization_applied": optimization_applied,
            "changelog": changelog,
            "generated_cover": generated_cover,
            "generated_content_images": generated_content_images,
            "generated_visual_queue": [x["url"] for x in (final_ctx.get("visual_images") or [])],
            "visual_queue": [x["url"] for x in (final_ctx.get("visual_images") or [])],
            "first_image_is_cover": bool(generated_cover),
            "image_errors": image_errors,
            "image_concurrency": image_concurrency if generate_content_images else None,
            "next_actions": [
                "打开笔记详情微调正文",
                "如需更强点击率，可继续重绘首图/封面",
                "运行 diagnose_article 做深度发布前诊断",
            ],
        },
    }


async def tool_rewrite_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    style = args.get("style", "更有网感、更口语化")
    instruction = args.get("instruction", "")
    uid = get_tool_user_id()

    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid is not None and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}

    await _snapshot_article(aid, "rewrite")
    from .research_data import detect_category
    playbook = _category_playbook_text(detect_category(art.title or "", art.body or "", (art.tags or "").split(",")))

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": XHS_WRITER_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"请基于下列笔记改写为小红书风格。\n改写风格：{style}\n附加要求：{instruction}\n"
                    f"{playbook}\n"
                    f"{_article_prompt_context(art)}\n"
                    "改写执行要求：\n"
                    "1. 先提炼原帖事实与卖点，再换一个新的小红书切入角度重写，不要缩写原文。\n"
                    "2. 标题、开头、段落顺序、分区小标题、结尾互动都要重新设计；不要沿用原文句式。\n"
                    "3. 原帖高频词要做场景化替换，避免连续 12 个字以上与原文一致，避免关键词堆叠。\n"
                    "4. 如果原文来自房源/民宿/酒店介绍，要把房源信息和房客评价改成用户视角体验：适合谁、住起来怎样、周边怎么玩、需要提前确认什么。\n"
                    "注意：保留与现有首图/后续图片匹配的叙事，不要写出和图片明显冲突的场景。\n"
                    "严格按系统要求 JSON 返回。"
                ),
            },
        ],
        temperature=0.92,
    )
    content = resp.choices[0].message.content or ""
    data = _safe_json(content)

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.title = _normalize_title(data.get("title"), art.title)
        art.body = data.get("body") or art.body
        if data.get("tags"):
            art.tags = ",".join(_normalize_tags(data["tags"]))
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


async def tool_imitate_article_style(args: Dict[str, Any]) -> Dict[str, Any]:
    """Imitate a reference note's writing/visual style into a target or new note."""
    ref_id = int(args.get("reference_article_id") or args.get("source_article_id") or 0)
    if ref_id <= 0:
        return {"ok": False, "error": "reference_article_id is required"}

    raw_target = args.get("target_article_id", args.get("article_id"))
    target_id = int(raw_target) if str(raw_target or "").strip().isdigit() and int(raw_target) > 0 else None
    topic = str(args.get("topic") or "").strip()
    instruction = str(args.get("instruction") or "").strip()
    generate_images_flag = bool(args.get("generate_images", False))
    image_count = _safe_int(args.get("image_count", 3), 3, min_value=0, max_value=6)
    image_mode = str(args.get("image_mode") or "edit_reference").strip().lower()
    size = _infer_image_size_from_request(" ".join([topic, instruction, str(args.get("size") or "")]), args.get("size"))
    quality = str(args.get("quality") or "high")

    ref, err = await _get_article_for_user(ref_id)
    if err:
        return {"ok": False, "error": err}
    assert ref is not None

    target: Optional[Article] = None
    if target_id:
        target, err = await _get_article_for_user(target_id)
        if err:
            return {"ok": False, "error": err}
        assert target is not None
        await _snapshot_article(target_id, f"imitate_style:{ref_id}")

    from .research_data import detect_category

    seed_title = target.title if target else topic
    seed_body = target.body if target else ""
    seed_tags = (target.tags or "").split(",") if target else []
    category = detect_category(seed_title or ref.title or topic, seed_body or ref.body or "", seed_tags)
    playbook = _category_playbook_text(category)
    ref_ctx = _article_image_context(ref)
    ref_images = ref_ctx.get("visual_images") or []
    ref_image_lines = "\n".join(
        f"- position={x.get('position')} role={x.get('role')} stored={x.get('url')} full={x.get('full_url') or x.get('model_url') or x.get('url')}"
        for x in ref_images[:8]
    ) or "无"

    emit_tool_progress(
        f"正在提取参考笔记 #{ref_id} 的写法和视觉风格",
        step="imitate_style_analyze",
        data={"reference_article_id": ref_id, "target_article_id": target_id},
    )
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书风格仿写专家。你的任务不是复制原文，而是提取参考笔记的结构、语气、节奏、标题套路、"
                    "信息组织和视觉风格，再生成一篇新的小红书笔记。避免照搬连续 12 个字以上的原句，避免虚构无法从主题推出的事实。\n"
                    "严格按 JSON 返回："
                    "{"
                    '"style_profile":{"tone":"语气","structure":"结构","hook":"开头钩子套路","visual_style":"图片风格"},'
                    '"title":"新标题",'
                    '"body":"新正文",'
                    '"tags":["#标签"],'
                    '"image_plan":[{"source_position":0,"role":"cover/content","prompt":"基于参考图做同风格变体的图片编辑提示词","size":"1152x1536"}]'
                    "}"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"【参考笔记】\n{_article_prompt_context(ref, body_limit=5000)}\n\n"
                    f"【参考图片完整 URL】\n{ref_image_lines}\n\n"
                    + (f"【要改写/仿写到的目标笔记】\n{_article_prompt_context(target, body_limit=5000)}\n\n" if target else "")
                    + f"【新主题/要求】\n主题：{topic or '沿用目标笔记主题/参考笔记同赛道'}\n补充要求：{instruction or '保持信息真实、口语化、有收藏价值'}\n"
                    f"{playbook}\n"
                    "请输出可直接写入草稿箱的标题、正文、标签；如果需要生成图片，image_plan 要让 edit_image 基于参考图做同风格变体，而不是原图复制。"
                ),
            },
        ],
        temperature=0.78,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    title = _normalize_title(data.get("title"), target.title if target else topic or ref.title or "仿写笔记")
    body = str(data.get("body") or (target.body if target else "")).strip()
    fallback_tags = (target.tags or "").split(",") if target else (ref.tags or "").split(",")
    tags = _normalize_tags(data.get("tags") or fallback_tags)
    style_profile = data.get("style_profile") if isinstance(data.get("style_profile"), dict) else {}
    image_plan = data.get("image_plan") if isinstance(data.get("image_plan"), list) else []

    uid = get_tool_user_id()
    async with SessionLocal() as s:
        if target_id:
            art = await s.get(Article, target_id)
            if not art:
                return {"ok": False, "error": f"article {target_id} not found"}
            art.title = _normalize_title(title, art.title)
            art.body = body or art.body
            if tags:
                art.tags = ",".join(tags)
        else:
            art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
            s.add(art)
        art.score = _score_for_article(art)
        await s.commit()
        await s.refresh(art)
        out_id = int(art.id)

    image_results: List[Dict[str, Any]] = []
    image_errors: List[Dict[str, Any]] = []
    if generate_images_flag and image_count > 0:
        emit_tool_progress(
            f"开始参考笔记 #{ref_id} 的图片做同风格变体",
            step="imitate_images_start",
            data={"reference_article_id": ref_id, "target_article_id": out_id, "image_count": image_count, "mode": image_mode},
        )
        ref_queue = [str(x.get("url") or "").strip() for x in ref_images if str(x.get("url") or "").strip()]
        ref_queue = ref_queue[:image_count]
        if image_mode in {"edit_reference", "edit", "variation", "imitate"} and ref_queue:
            for idx, src in enumerate(ref_queue):
                plan = image_plan[idx] if idx < len(image_plan) and isinstance(image_plan[idx], dict) else {}
                role = "cover" if idx == 0 else "content"
                edit_prompt = str(plan.get("prompt") or "").strip() or (
                    f"参考这张图的构图、色调、排版和小红书质感，为新笔记《{title}》生成同风格变体。"
                    "保留风格，不复制原图具体内容；画面清晰，高级，有收藏转发感。"
                )
                r = await tool_edit_image(
                    {
                        "image_url": src,
                        "source_article_id": ref_id,
                        "article_id": out_id,
                        "role": role,
                        "replace_index": idx - 1 if idx > 0 else None,
                        "prompt": edit_prompt,
                        "size": str(plan.get("size") or size),
                        "quality": quality,
                    }
                )
                if r.get("ok"):
                    image_results.append({"source_image": src, "role": role, "image": r.get("image"), "elapsed_ms": r.get("elapsed_ms")})
                else:
                    image_errors.append({"source_image": src, "role": role, "error": r.get("error")})
        else:
            ref_full = [str(x.get("model_url") or x.get("full_url") or x.get("url")) for x in ref_images[:3]]
            prompt = (
                f"小红书同风格图片，参考笔记 #{ref_id} 的视觉风格：{style_profile.get('visual_style') or '干净、高级、有生活感'}。"
                f"新笔记标题：{title}。不要复制原图，生成新的同风格画面。"
            )
            r = await tool_generate_image(
                {
                    "prompt": prompt,
                    "reference_images": ref_full,
                    "article_id": out_id,
                    "role": "cover",
                    "n": image_count,
                    "size": size,
                    "quality": quality,
                }
            )
            if r.get("ok"):
                image_results.extend([{"role": "generated", "image": u} for u in (r.get("images") or [])])
            else:
                image_errors.append({"role": "generated", "error": r.get("error")})

    final = await _refresh_article_local_score(out_id) or await _get_article(out_id)
    return {
        "ok": True,
        "reference_article_id": ref_id,
        "target_article_id": target_id,
        "article_id": out_id,
        "article": _article_payload(final) if final else None,
        "style_profile": style_profile,
        "image_plan": image_plan[:6],
        "image_results": image_results,
        "image_errors": image_errors,
        "message": "已按参考笔记完成仿写；如启用图片，已用参考图做同风格变体并绑定到目标笔记。",
    }


async def tool_optimize_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    focus = args.get("focus", "标题吸引力、开头钩子、情绪价值、标签")
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid is not None and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}

    await _snapshot_article(aid, "optimize")
    from .research_data import detect_category
    playbook = _category_playbook_text(detect_category(art.title or "", art.body or "", (art.tags or "").split(",")))

    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书内容优化顾问。在保留原意基础上优化文案。"
                    "严格按 JSON 返回："
                    '{"title":"...","body":"...","tags":["#..."],"changelog":["改动点..."]}'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"优化重点：{focus}\n{playbook}\n{_article_prompt_context(art)}\n"
                    "若涉及视觉/封面/配图，请结合现有图片数量和图片 URL 给出一致的文案优化。"
                ),
            },
        ],
        temperature=0.7,
    )
    content = resp.choices[0].message.content or ""
    data = _safe_json(content)

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.title = _normalize_title(data.get("title"), art.title)
        art.body = data.get("body") or art.body
        if data.get("tags"):
            art.tags = ",".join(_normalize_tags(data["tags"]))
        await s.commit()
        await s.refresh(art)
        result = _article_payload(art)
        result["changelog"] = data.get("changelog", [])
        return {"ok": True, "article": result}


async def tool_polish_paragraph(args: Dict[str, Any]) -> Dict[str, Any]:
    paragraph = args.get("paragraph") or ""
    style = args.get("style", "更有网感、更口语化")
    if not paragraph:
        return {"ok": False, "error": "paragraph is required"}
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书文案润色师，只返回优化后的段落，不要解释。保留原意、原信息密度。"
                ),
            },
            {"role": "user", "content": f"风格：{style}\n段落：\n{paragraph}"},
        ],
        temperature=0.7,
    )
    text = (resp.choices[0].message.content or "").strip()
    return {"ok": True, "paragraph": text}


# ---------- scoring & diagnostic ----------

async def tool_score_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid is not None and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}
    fallback = _score_for_article(art)
    try:
        resp = await chat_completion(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是小红书数据专家，从五个维度打分（0-100）："
                        "内容质量 content、视觉吸引 visual、增长潜力 growth、互动潜力 engagement、综合 overall。"
                        "visual 必须结合首图、后续图片数量、图片 URL/尺寸元数据和图文匹配度评估；"
                        "没有图片时要明确扣分原因。即使你无法读取图片像素，也要基于 image_context、图片数量、尺寸和图文关系给出非零结构化评分。"
                        "严格按 JSON 返回，五个数字字段必须完整："
                        '{"content":90,"visual":80,"growth":75,"engagement":82,"overall":82,"advice":["..."]}'
                    ),
                },
                {"role": "user", "content": _article_prompt_context(art)},
            ],
            temperature=0.3,
        )
        raw = _safe_json(resp.choices[0].message.content or "")
        data = _normalize_score_payload(raw, fallback)
    except Exception as e:
        data = dict(fallback)
        data["model"] = "local_model_a_fallback"
        data["advice"] = [f"模型评分暂不可用，已使用本地五维规则评分：{str(e)[:160]}"] + list(data.get("advice") or [])[:4]
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.score = data
        await s.commit()
        await s.refresh(art)
    return {"ok": True, "score": data, "article_id": aid}


def _diagnosis_result_payload(
    result: Any,
    article_id: int,
    *,
    image_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Serialize a DiagnosisResult into the API/frontend shape."""
    return {
        "article_id": article_id,
        "image_context": image_context or {},
        "overall_score": getattr(result, "overall_score", 0),
        "grade": getattr(result, "grade", ""),
        "radar_data": getattr(result, "radar_data", {}),
        "issues": getattr(result, "issues", []),
        "suggestions": getattr(result, "suggestions", []),
        "optimized_title": getattr(result, "optimized_title", ""),
        "optimized_content": getattr(result, "optimized_content", ""),
        "optimized_tags": getattr(result, "optimized_tags", []),
        "cover_direction": getattr(result, "cover_direction", {}),
        "simulated_comments": getattr(result, "simulated_comments", []),
        "debate_summary": getattr(result, "debate_summary", ""),
        "agent_opinions": getattr(result, "agent_opinions", []),
        "debate_results": getattr(result, "debate_results", []),
        "model_a_score": getattr(result, "model_a_score", {}),
        "text_analysis": getattr(result, "text_analysis", {}),
        "category": getattr(result, "category", ""),
        "category_cn": getattr(result, "category_cn", ""),
        "elapsed_ms": getattr(result, "elapsed_ms", 0),
    }


async def _save_diagnosis_report(
    article_id: int,
    report: Dict[str, Any],
    *,
    user_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Persist a diagnosis report and return its public payload."""
    async with SessionLocal() as s:
        diag = ArticleDiagnosis(
            article_id=int(article_id),
            user_id=user_id,
            report=dict(report or {}),
        )
        s.add(diag)
        await s.commit()
        await s.refresh(diag)
        return diag.to_dict()


async def tool_diagnose_article(args: Dict[str, Any]) -> Dict[str, Any]:
    """Multi-agent diagnosis: 4 experts + debate + judge."""
    from .diagnosis import run_diagnosis
    aid = int(args["article_id"])
    art, err = await _get_article_for_user(aid)
    if err:
        return {"ok": False, "error": err}
    assert art is not None

    tags = [t for t in (art.tags or "").split(",") if t.strip()]
    image_ctx = _article_image_context(art)
    visual_images = [
        str(x.get("model_url") or x.get("full_url") or x.get("url"))
        for x in image_ctx.get("visual_images", [])
        if x.get("url")
    ]
    image_count = len(visual_images)
    cover_image = str(image_ctx.get("cover_image_full_url") or image_ctx.get("cover_image") or "")

    result = await run_diagnosis(
        title=art.title or "",
        content=art.body or "",
        tags=tags,
        image_count=image_count,
        images=visual_images,
        cover_image=cover_image,
    )

    payload = _diagnosis_result_payload(result, aid, image_context=image_ctx)
    saved = await _save_diagnosis_report(aid, payload, user_id=get_tool_user_id())
    return {"ok": True, **saved}


# ---------- ideation ----------

async def tool_suggest_tags(args: Dict[str, Any]) -> Dict[str, Any]:
    topic = args.get("topic") or ""
    body = args.get("body") or ""
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "根据主题/内容，输出 6-10 个小红书高流量标签。"
                    '严格按 JSON 返回：{"tags":["#...","#..."]}'
                ),
            },
            {"role": "user", "content": f"主题：{topic}\n内容：{body}"},
        ],
        temperature=0.6,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "tags": data.get("tags", [])}


async def tool_suggest_titles(args: Dict[str, Any]) -> Dict[str, Any]:
    topic = args.get("topic") or ""
    body = args.get("body") or ""
    n = _safe_int(args.get("n", 6), 6, min_value=1, max_value=12)
    from .research_data import detect_category
    playbook = _category_playbook_text(detect_category(str(topic), str(body), []))
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是小红书爆款标题专家。给 {n} 个候选标题。"
                    "每条 ≤20 字，风格各异（数字党/悬念党/共鸣党/反转党/痛点党等），最多 2 个 emoji。"
                    '严格按 JSON：{"titles":["...","..."]}'
                ),
            },
            {"role": "user", "content": f"主题：{topic}\n素材：{body}\n{playbook}"},
        ],
        temperature=0.95,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    titles = [_normalize_title(x) for x in (data.get("titles") or []) if _normalize_title(x)]
    return {"ok": True, "titles": titles[:n]}


async def tool_outline_article(args: Dict[str, Any]) -> Dict[str, Any]:
    topic = args.get("topic") or ""
    audience = args.get("audience", "小红书主力用户")
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书选题专家。给出一篇笔记的大纲：钩子、正文段落要点（3-5 段）、CTA。"
                    '严格按 JSON：{"hook":"...","sections":[{"title":"...","points":["..."]}],"cta":"..."}'
                ),
            },
            {"role": "user", "content": f"主题：{topic}\n受众：{audience}"},
        ],
        temperature=0.7,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "outline": data}


async def tool_cover_prompt(args: Dict[str, Any]) -> Dict[str, Any]:
    topic = args.get("topic") or ""
    title = args.get("title") or topic
    style = args.get("style", "小红书风、干净、高级感、柔和光")
    from .research_data import detect_category
    playbook = _category_playbook_text(detect_category(str(title), str(topic), []))
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书封面视觉总监，精通平台爆款封面的设计规律。\n\n"
                    "根据用户提供的主题和标题，输出一条中文图片生成 prompt。\n\n"
                    "【封面设计原则】\n"
                    "- 构图：三分法或居中构图，主体占画面 60-70%，适当留白放文字\n"
                    "- 色彩：根据内容选择色调——暖色系（亲和/美食/生活）、冷色系（高级/科技/职场）、莫兰迪色（文艺/穿搭）\n"
                    "- 光影：柔和自然光为主，避免硬光和过度 HDR\n"
                    "- 文字区域：预留上方或中央 1/3 空间给标题文字叠加\n"
                    "- 风格参考：干净通透、有呼吸感、细节精致\n\n"
                    "【不同类型封面指导】\n"
                    "- 教程类：步骤分格/before-after 对比/关键步骤特写\n"
                    "- 种草类：产品平铺/使用场景/氛围感静物\n"
                    "- 情绪类：人物侧脸/光影氛围/意境空镜\n"
                    "- 清单类：多图拼贴/网格排列/数字标注\n"
                    "- 对比类：左右分屏/前后对比/色彩反差\n\n"
                    "prompt 用中文描述，要具体到：主体内容、构图方式、光线氛围、色彩基调、画面风格。\n"
                    "默认竖图比例 3:4；如果用户明确指定 2K/4K/16:9/1:1 等分辨率或比例，size 必须匹配。\n"
                    '严格 JSON：{"prompt":"中文描述...","size":"1152x1536","quality":"high"}'
                ),
            },
            {"role": "user", "content": f"标题：{title}\n主题：{topic}\n风格偏好：{style}\n{playbook}"},
        ],
        temperature=0.8,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "cover": data}


# ---------- images ----------

async def tool_generate_image(args: Dict[str, Any]) -> Dict[str, Any]:
    prompt = (args.get("prompt") or "").strip()
    if not prompt:
        return {"ok": False, "error": "prompt is required"}
    size = _infer_image_size_from_request(prompt, args.get("size"))
    quality = args.get("quality", "high")
    n = _safe_int(args.get("n", 1), 1, min_value=1, max_value=4)
    raw_aid = args.get("article_id")
    aid = int(raw_aid) if str(raw_aid or "").strip().isdigit() and int(raw_aid) > 0 else None
    role = args.get("role", "content")
    replace_index = args.get("replace_index")
    access_err = await _ensure_article_access(aid)
    if access_err:
        return access_err
    emit_tool_progress(
        "正在生成图片" + (f"并准备绑定到笔记 #{aid}" if aid else "（独立图片，不创建笔记）"),
        step="image_generation_start",
        data={"article_id": aid, "size": size, "quality": quality, "n": n},
    )
    img_start = time.perf_counter()
    try:
        urls = await _await_with_progress(
            generate_image(
                prompt=prompt,
                size=size,
                quality=quality,
                n=n,
                reference_images=args.get("reference_images"),
            ),
            label="图片生成",
            step="image_generation",
            data={"article_id": aid, "size": size, "quality": quality, "n": n},
        )
    except Exception as e:
        elapsed = _elapsed_ms(img_start)
        msg = _friendly_tool_error(e, elapsed_ms=elapsed, action="图片生成")
        emit_tool_progress(
            msg,
            step="image_generation_failed",
            data={
                "article_id": aid,
                "size": size,
                "quality": quality,
                "elapsed_ms": elapsed,
                "timeout": _is_timeout_error(e),
            },
        )
        return {
            "ok": False,
            "error": msg,
            "raw_error": str(e)[:1000],
            "timeout": _is_timeout_error(e),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
            "suggestions": [
                "降低 size，例如 1536x2048 → 1152x1536",
                "将 quality 从 high 改为 medium/auto",
                "减少中文密集文字和分区数量，先生成背景再用编辑器叠字",
            ],
            "retry_options": _image_retry_options(prompt, str(size), str(quality), n),
        }
    elapsed_done = _elapsed_ms(img_start)
    emit_tool_progress(
        f"图片生成完成，共 {len(urls)} 张，用时 {_fmt_elapsed(elapsed_done)}" + ("，正在写入笔记" if aid else ""),
        step="image_generation_done",
        data={"article_id": aid, "count": len(urls), "elapsed_ms": elapsed_done},
    )
    bound_article: Optional[Dict[str, Any]] = None
    if aid:
        bound_article = await _bind_generated_urls_to_article(aid, urls, role=role, replace_index=replace_index)
        if bound_article:
            emit_tool_progress(
                "图片已绑定到笔记，第 1 张按小红书首图/封面展示",
                step="image_bound",
                data={"article_id": aid, "role": role, "count": len(urls), "first_image_is_cover": True},
            )
    result: Dict[str, Any] = {
        "ok": True,
        "images": urls,
        "elapsed_ms": elapsed_done,
        "elapsed_sec": round(elapsed_done / 1000, 2),
    }
    if bound_article:
        result["article"] = bound_article
    return result


async def tool_remove_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove an image from an article (cover or a specific content image)."""
    aid = int(args["article_id"])
    role = args.get("role", "content")
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        uid = get_tool_user_id()
        if uid is not None and art.user_id != uid:
            return {"ok": False, "error": "无权操作该笔记"}
        queue = _article_visual_queue(art)
        if role == "cover":
            if queue:
                queue.pop(0)
        else:
            idx = args.get("index")
            if idx is None:
                queue = queue[:1] if queue else []
            else:
                idx = _safe_int(idx, -1)
                if idx < 0:
                    return {"ok": False, "error": "index must be a non-negative integer"}
                visual_pos = idx + 1
                if 0 <= visual_pos < len(queue):
                    queue.pop(visual_pos)
                else:
                    return {"ok": False, "error": f"index {idx} out of range"}
        _apply_article_visual_queue(art, queue)
        art.score = _score_for_article(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


def _article_visual_queue(art: Article) -> List[str]:
    """Return the Xiaohongshu-style image queue; position 0 is the cover/first image."""
    queue: List[str] = []
    if (art.cover_image or "").strip():
        queue.append(str(art.cover_image).strip())
    queue.extend([str(x).strip() for x in (art.images or []) if str(x or "").strip()])
    return _dedupe_preserve_order(queue)


def _dedupe_preserve_order(items: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in items:
        item = str(raw or "").strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _apply_article_visual_queue(art: Article, queue: List[str]) -> None:
    queue = _dedupe_preserve_order([_canonicalize_app_image_ref(x) for x in queue])
    art.cover_image = queue[0] if queue else ""
    art.images = queue[1:] if len(queue) > 1 else []


async def tool_arrange_article_images(args: Dict[str, Any]) -> Dict[str, Any]:
    """Arrange article images as one visual queue; position 0 is the cover/first image."""
    aid = int(args["article_id"])
    action = str(args.get("action") or "set_order").strip().lower()
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        uid = get_tool_user_id()
        if uid is not None and art.user_id != uid:
            return {"ok": False, "error": "无权操作该笔记"}

        queue = _article_visual_queue(art)
        image_url = str(args.get("image_url") or "").strip()

        if action in {"set_order", "reorder"}:
            order = args.get("order")
            if not isinstance(order, list):
                return {"ok": False, "error": "order must be a list of image URLs"}
            queue = _dedupe_preserve_order([str(x) for x in order])
        elif action == "move":
            if not queue:
                return {"ok": False, "error": "no images to move"}
            from_pos = _safe_int(args.get("from_position"), -1)
            to_pos = _safe_int(args.get("to_position"), -1)
            if from_pos < 0 or from_pos >= len(queue):
                return {"ok": False, "error": f"from_position {from_pos} out of range"}
            to_pos = max(0, min(len(queue) - 1, to_pos))
            item = queue.pop(from_pos)
            queue.insert(to_pos, item)
        elif action in {"set_cover", "make_cover", "set_first"}:
            pos_arg = args.get("position")
            if image_url:
                if image_url in queue:
                    queue.remove(image_url)
                queue.insert(0, image_url)
            else:
                pos = _safe_int(pos_arg, -1)
                if pos < 0 or pos >= len(queue):
                    return {"ok": False, "error": f"position {pos} out of range"}
                item = queue.pop(pos)
                queue.insert(0, item)
        elif action == "insert":
            if not image_url:
                return {"ok": False, "error": "image_url is required for insert"}
            pos = _safe_int(args.get("position"), len(queue), min_value=0, max_value=len(queue))
            if image_url in queue:
                queue.remove(image_url)
                pos = min(pos, len(queue))
            queue.insert(pos, image_url)
        elif action == "replace":
            if not image_url:
                return {"ok": False, "error": "image_url is required for replace"}
            pos = _safe_int(args.get("position"), 0, min_value=0)
            if pos < len(queue):
                queue[pos] = image_url
            else:
                queue.append(image_url)
        elif action == "remove":
            if image_url:
                queue = [x for x in queue if x != image_url]
            else:
                pos = _safe_int(args.get("position"), -1)
                if pos < 0 or pos >= len(queue):
                    return {"ok": False, "error": f"position {pos} out of range"}
                queue.pop(pos)
        elif action == "clear":
            queue = []
        else:
            return {"ok": False, "error": f"unknown action: {action}"}

        _apply_article_visual_queue(art, queue)
        await s.commit()
        await s.refresh(art)
        emit_tool_progress(
            "图片队列已更新：首图即封面",
            step="article_images_arranged",
            data={"article_id": aid, "action": action, "image_count": len(_article_visual_queue(art))},
        )
        return {
            "ok": True,
            "article": _article_payload(art),
            "visual_queue": _article_visual_queue(art),
            "message": "已更新图片顺序。第 1 张会作为小红书首图/封面展示。",
        }


async def tool_content_image_prompt(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = args.get("article_id")
    topic = args.get("topic", "")
    title = args.get("title", "")
    body = args.get("body", "")
    n = _safe_int(args.get("n", 4), 4, min_value=1, max_value=8)
    style = str(args.get("style") or "小红书风、统一色调、干净高级、有生活感")
    image_context_text = "当前没有已知配图。"
    if aid and not body:
        art, err = await _get_article_for_user(int(aid))
        if err:
            return {"ok": False, "error": err}
        assert art is not None
        title = title or art.title
        body = art.body
        topic = topic or art.title
        image_context_text = _article_image_summary_text(art)
    from .research_data import detect_category
    category = detect_category(str(title or topic), str(body), [])
    playbook = _category_playbook_text(category)
    series_style = _series_visual_style(title=str(title or topic), category=category, style=style)
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是小红书图片队列导演，擅长将文字转化为一组有连续感的视觉画面。\n\n"
                    f"根据笔记内容，产出 {n} 条配图 prompt（中文），每条对应正文的一个段落或核心信息点。\n\n"
                    "【配图原则】\n"
                    "- 视觉一致性：所有配图保持统一的色调、风格和滤镜感\n"
                    f"- 整组风格锚点：{series_style}\n"
                    "- 场景化：每张图要有生活感和氛围感，避免纯产品白底图\n"
                    "- 信息承载：图片要能独立传达该段落的核心信息\n"
                    "- 细节丰富：注重质感、光影、环境细节的描述\n\n"
                    "【prompt 描述要素】\n"
                    "- 主体内容：画面中心是什么\n"
                    "- 场景环境：在哪里、什么背景\n"
                    "- 光线氛围：自然光/暖光/侧光/逆光\n"
                    "- 色彩基调：与整组图保持一致\n"
                    "- 拍摄视角：俯拍/平视/特写/远景\n"
                    "- 画面风格：清新/复古/极简/日系等\n\n"
                    "默认竖版比例 3:4。若用户指定 2K/4K/16:9/1:1 等，必须按用户比例和分辨率写 size。prompt 用中文。\n"
                    '严格按 JSON 返回：'
                    '{"shots":[{"scene":"场景标题","prompt":"中文描述","size":"1152x1536","quality":"high"}]}'
                ),
            },
            {
                "role": "user",
                "content": f"主题：{topic}\n标题：{title}\n视觉风格：{style}\n{playbook}\n已有图片：\n{image_context_text}\n正文：\n{body}",
            },
        ],
        temperature=0.8,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    normalized = _normalize_shots(data.get("shots", [])[:n], limit=n)
    if not normalized:
        normalized = _fallback_storyboard_shots(str(title or topic), str(body), n)
    storyboard = _build_image_storyboard(
        normalized,
        title=str(title or topic),
        category=category,
        style=style,
        size_hint_text=" ".join(str(x or "") for x in (topic, title, body[:400], args.get("size"))),
    )
    return {
        "ok": True,
        "shots": storyboard["shots"],
        "image_storyboard": storyboard,
        "series_style": storyboard["series_style"],
    }


async def tool_generate_article_images(args: Dict[str, Any]) -> Dict[str, Any]:
    """Generate images for an existing article's XHS visual queue."""
    aid = int(args["article_id"])
    art, err = await _get_article_for_user(aid)
    if err:
        return {"ok": False, "error": err}
    assert art is not None

    had_visuals_before = bool(_article_visual_queue(art))
    include_cover = bool(args.get("include_cover", False))
    raw_content_count = args.get("content_count", args.get("n"))
    if raw_content_count is None:
        raw_content_count = 0 if include_cover else 4
    content_count = _safe_int(raw_content_count, 0 if include_cover else 4, min_value=0, max_value=8)
    concurrency = _safe_int(args.get("concurrency", args.get("image_concurrency", 3)), 3, min_value=1, max_value=4)
    replace_existing = bool(args.get("replace_existing", False))
    size_hint_text = " ".join(str(x or "") for x in (args.get("style"), args.get("size"), args.get("cover_size"), art.title, art.body))
    default_size = _infer_image_size_from_request(size_hint_text, args.get("size"))
    default_quality = args.get("quality", "high")
    style = args.get("style", "小红书风、统一色调、干净高级、有生活感")
    image_errors: List[Dict[str, Any]] = []
    generated_cover = ""
    generated_content_images: List[str] = []
    total_start = time.perf_counter()

    emit_tool_progress(
        f"正在为笔记 #{aid} 准备图片生成任务",
        step="article_images_prepare",
        data={"article_id": aid, "include_cover": include_cover, "content_count": content_count, "concurrency": concurrency},
    )

    if include_cover:
        cover_prompt = args.get("cover_prompt")
        if not cover_prompt:
            cover_resp = await tool_cover_prompt({"topic": art.title or "", "title": art.title or "", "style": style})
            cover_prompt = (cover_resp.get("cover") or {}).get("prompt") or f"小红书首图/封面，主题：{art.title}，{style}"
        cover_size = _infer_image_size_from_request(size_hint_text, args.get("cover_size") or default_size)
        cover_start = time.perf_counter()
        emit_tool_progress("正在生成笔记展示队列第 1 张（首图）", step="article_cover_start", data={"article_id": aid})
        try:
            urls = await _await_with_progress(
                generate_image(
                    prompt=str(cover_prompt),
                    size=str(cover_size),
                    quality=str(default_quality),
                    n=1,
                ),
                label="笔记首图",
                step="article_cover",
                data={"article_id": aid, "role": "cover"},
            )
            generated_cover = urls[0] if urls else ""
            if generated_cover:
                await _bind_image_to_article(generated_cover, aid, role="cover")
                emit_tool_progress(
                    f"首图已生成并绑定到展示队列第 1 位，用时 {_fmt_elapsed(_elapsed_ms(cover_start))}",
                    step="article_cover_done",
                    data={"article_id": aid, "image": generated_cover, "elapsed_ms": _elapsed_ms(cover_start)},
                )
        except Exception as e:
            elapsed = _elapsed_ms(cover_start)
            msg = _friendly_tool_error(e, elapsed_ms=elapsed, action="首图生成")
            image_errors.append({"role": "cover", "error": msg, "elapsed_ms": elapsed})
            emit_tool_progress(msg, step="article_cover_failed", data={"article_id": aid, "elapsed_ms": elapsed})

    shots = args.get("shots")
    if not isinstance(shots, list) or not shots:
        if content_count > 0:
            prompt_resp = await tool_content_image_prompt({"article_id": aid, "n": content_count, "style": style, "size": default_size})
            if not prompt_resp.get("ok"):
                return prompt_resp
            shots = prompt_resp.get("shots") or []
    shots = _normalize_shots(shots or [], limit=content_count or 0)
    if content_count > 0 and not shots:
        shots = _fallback_storyboard_shots(art.title or "", art.body or "", content_count)
    from .research_data import detect_category
    image_storyboard = _build_image_storyboard(
        shots,
        title=art.title or "",
        category=detect_category(art.title or "", art.body or "", (art.tags or "").split(",")),
        style=style,
        size_hint_text=size_hint_text,
        default_size=default_size,
        default_quality=str(default_quality),
    )
    shots = image_storyboard["shots"]

    if shots:
        emit_tool_progress(
            f"开始并发生成 {len(shots)} 张后续队列图片（并发数 {concurrency}）",
            step="article_content_images_start",
            data={"article_id": aid, "count": len(shots), "concurrency": concurrency, "series_style": image_storyboard["series_style"]},
        )
        sem = asyncio.Semaphore(concurrency)

        async def _gen(idx: int, shot: Dict[str, str]) -> Dict[str, Any]:
            async with sem:
                scene = shot.get("scene") or f"配图{idx + 1}"
                start = time.perf_counter()
                emit_tool_progress(
                    f"队列图片 {idx + 1}/{len(shots)} 开始生成：{scene}",
                    step="article_content_image_start",
                    data={"article_id": aid, "index": idx, "scene": scene},
                )
                try:
                    urls = await _await_with_progress(
                        generate_image(
                            prompt=shot["prompt"],
                            size=shot.get("size", default_size),
                            quality=shot.get("quality", default_quality),
                            n=1,
                        ),
                        label=f"队列图片 {idx + 1}/{len(shots)}",
                        step=f"article_content_image_{idx}",
                        data={"article_id": aid, "index": idx, "scene": scene},
                    )
                    elapsed = _elapsed_ms(start)
                    url = urls[0] if urls else ""
                    emit_tool_progress(
                        f"队列图片 {idx + 1} 完成，用时 {_fmt_elapsed(elapsed)}",
                        step="article_content_image_done",
                        data={"article_id": aid, "index": idx, "image": url, "elapsed_ms": elapsed},
                    )
                    return {"index": idx, "url": url, "elapsed_ms": elapsed, "scene": scene}
                except Exception as e:
                    elapsed = _elapsed_ms(start)
                    msg = _friendly_tool_error(e, elapsed_ms=elapsed, action=f"队列图片 {idx + 1} 生成")
                    emit_tool_progress(
                        msg,
                        step="article_content_image_failed",
                        data={"article_id": aid, "index": idx, "scene": scene, "elapsed_ms": elapsed},
                    )
                    return {"index": idx, "url": "", "error": msg, "elapsed_ms": elapsed, "scene": scene}

        results = await asyncio.gather(*[_gen(i, shot) for i, shot in enumerate(shots)])
        for item in sorted(results, key=lambda x: int(x.get("index", 0))):
            if item.get("url"):
                generated_content_images.append(str(item["url"]))
            elif item.get("error"):
                image_errors.append({"role": "content", **item})

        if generated_content_images:
            # 统一按小红书展示队列写入：队列第 1 张就是首图/封面。
            async with SessionLocal() as s:
                art = await s.get(Article, aid)
                if art:
                    queue = _article_visual_queue(art)
                    if replace_existing:
                        queue = (queue[:1] if queue else []) + generated_content_images
                    else:
                        queue.extend(generated_content_images)
                    _apply_article_visual_queue(art, queue)
                    await s.commit()

    newly_generated_content_images = list(generated_content_images)
    final = await _refresh_article_local_score(aid) or await _get_article(aid)
    final_ctx = _article_image_context(final) if final else {}
    cover_image = str(final_ctx.get("cover_image") or generated_cover or "")
    if not generated_cover and not had_visuals_before and newly_generated_content_images:
        generated_cover = newly_generated_content_images[0]
        generated_content_images = newly_generated_content_images[1:]
    else:
        generated_cover = generated_cover or cover_image
        generated_content_images = newly_generated_content_images
    elapsed = _elapsed_ms(total_start)
    emit_tool_progress(
        f"笔记图片生成任务完成：首图/封面已就绪，当前共 {int(final_ctx.get('image_count') or 0)} 张，失败 {len(image_errors)} 项，用时 {_fmt_elapsed(elapsed)}",
        step="article_images_done",
        data={
            "article_id": aid,
            "success": int(final_ctx.get("image_count") or (len(generated_content_images) + (1 if generated_cover else 0))),
            "failed": len(image_errors),
            "elapsed_ms": elapsed,
            "first_image_is_cover": bool(generated_cover),
        },
    )
    return {
        "ok": len(generated_content_images) > 0 or bool(generated_cover) or not image_errors,
        "article_id": aid,
        "cover_image": cover_image,
        "generated_cover": generated_cover,
        "generated_content_images": generated_content_images,
        "generated_visual_queue": [x["url"] for x in (final_ctx.get("visual_images") or [])],
        "first_image_is_cover": bool(generated_cover),
        "visual_queue": [x["url"] for x in (final_ctx.get("visual_images") or [])],
        "image_storyboard": image_storyboard if shots else {"series_style": _series_visual_style(title=art.title or "", style=style), "shots": []},
        "image_errors": image_errors,
        "concurrency": concurrency,
        "elapsed_ms": elapsed,
        "elapsed_sec": round(elapsed / 1000, 2),
        "article": _article_payload(final) if final else None,
    }


# ---------- image editing (crop / inpaint / remove) ----------

async def _bind_image_to_article(
    url: str,
    article_id: Optional[int],
    role: str = "content",
    replace_index: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    if not article_id:
        return None
    bound = await _bind_generated_urls_to_article(article_id, [url], role=role, replace_index=replace_index)
    return None if bound else {"ok": False, "error": f"article {article_id} not found"}


async def _bind_generated_urls_to_article(
    article_id: int,
    urls: List[str],
    *,
    role: str = "content",
    replace_index: Optional[Any] = None,
) -> Optional[Dict[str, Any]]:
    """Bind generated image URLs using the single Xiaohongshu visual queue.

    Invariant after binding:
    - Article.cover_image is the first/cover image whenever any image exists.
    - Article.images contains only images after the cover.
    """
    clean_urls = _dedupe_preserve_order([str(u).strip() for u in urls if str(u or "").strip()])
    if not clean_urls:
        return None
    async with SessionLocal() as s:
        art = await s.get(Article, int(article_id))
        if not art:
            return None
        uid = get_tool_user_id()
        if uid is not None and art.user_id != uid:
            return None
        queue = _article_visual_queue(art)
        if role == "cover":
            tail = queue[1:] if queue else []
            queue = [clean_urls[0]] + tail + clean_urls[1:]
        else:
            if replace_index is not None:
                idx = _safe_int(replace_index, 0, min_value=0)
                visual_pos = idx + 1 if queue else 0
                for offset, url in enumerate(clean_urls):
                    pos = visual_pos + offset
                    if 0 <= pos < len(queue):
                        queue[pos] = url
                    else:
                        queue.append(url)
            else:
                queue.extend(clean_urls)
        _apply_article_visual_queue(art, queue)
        art.score = _score_for_article(art)
        await s.commit()
        await s.refresh(art)
        return _article_payload(art)


async def tool_crop_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Crop an image by pixel box. Result can replace cover / content slot."""
    image_url = (args.get("image_url") or "").strip()
    if not image_url:
        return {"ok": False, "error": "image_url is required"}
    x = _safe_int(args.get("x", 0), 0, min_value=0)
    y = _safe_int(args.get("y", 0), 0, min_value=0)
    w = _safe_int(args.get("w", 0), 0, min_value=0)
    h = _safe_int(args.get("h", 0), 0, min_value=0)
    if w <= 0 or h <= 0:
        return {"ok": False, "error": "w/h must be > 0"}
    op_start = time.perf_counter()
    article_id = _optional_article_id(args.get("article_id"))
    access_err = await _ensure_article_image_access(article_id, image_url)
    if access_err:
        return access_err
    new_url = crop_image(image_url, x, y, w, h)
    bind_err = await _bind_image_to_article(
        new_url,
        article_id,
        args.get("role", "content"),
        args.get("replace_index"),
    )
    if bind_err:
        return bind_err
    elapsed = _elapsed_ms(op_start)
    return {"ok": True, "image": new_url, "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}


async def tool_inpaint_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Inpaint the transparent region of mask with new content described by prompt."""
    image_url = (args.get("image_url") or "").strip()
    mask_url = (args.get("mask_url") or "").strip()
    if not image_url or not mask_url:
        return {"ok": False, "error": "image_url and mask_url are required"}
    prompt = args.get("prompt") or "match surrounding style"
    size = args.get("size", "1024x1024")
    quality = args.get("quality", "high")
    op_start = time.perf_counter()
    article_id = _optional_article_id(args.get("article_id"))
    access_err = await _ensure_article_image_access(article_id, image_url)
    if access_err:
        return access_err
    try:
        urls = await _await_with_progress(
            edit_image(image_url, mask_url, prompt, size=size, quality=quality, n=1),
            label="局部重绘",
            step="inpaint_image",
            data={"image_url": image_url, "size": size, "quality": quality},
        )
    except Exception as e:
        elapsed = _elapsed_ms(op_start)
        return {
            "ok": False,
            "error": _friendly_tool_error(e, elapsed_ms=elapsed, action="局部重绘"),
            "raw_error": str(e)[:1000],
            "timeout": _is_timeout_error(e),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
        }
    if not urls:
        return {"ok": False, "error": "no image returned"}
    bind_err = await _bind_image_to_article(
        urls[0],
        article_id,
        args.get("role", "content"),
        args.get("replace_index"),
    )
    if bind_err:
        return bind_err
    elapsed = _elapsed_ms(op_start)
    return {"ok": True, "image": urls[0], "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}


async def tool_remove_object(args: Dict[str, Any]) -> Dict[str, Any]:
    """Erase / clean the masked region by inpainting with a 'clean background' prompt."""
    image_url = (args.get("image_url") or "").strip()
    mask_url = (args.get("mask_url") or "").strip()
    if not image_url or not mask_url:
        return {"ok": False, "error": "image_url and mask_url are required"}
    prompt = args.get("prompt") or (
        "seamlessly fill and clean this region, continue the surrounding background, "
        "remove any object present in the masked area, keep the same lighting, texture and color"
    )
    size = args.get("size", "1024x1024")
    quality = args.get("quality", "high")
    op_start = time.perf_counter()
    article_id = _optional_article_id(args.get("article_id"))
    access_err = await _ensure_article_image_access(article_id, image_url)
    if access_err:
        return access_err
    try:
        urls = await _await_with_progress(
            edit_image(image_url, mask_url, prompt, size=size, quality=quality, n=1),
            label="消除物体",
            step="remove_object",
            data={"image_url": image_url, "size": size, "quality": quality},
        )
    except Exception as e:
        elapsed = _elapsed_ms(op_start)
        return {
            "ok": False,
            "error": _friendly_tool_error(e, elapsed_ms=elapsed, action="消除物体"),
            "raw_error": str(e)[:1000],
            "timeout": _is_timeout_error(e),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
        }
    if not urls:
        return {"ok": False, "error": "no image returned"}
    bind_err = await _bind_image_to_article(
        urls[0],
        article_id,
        args.get("role", "content"),
        args.get("replace_index"),
    )
    if bind_err:
        return bind_err
    elapsed = _elapsed_ms(op_start)
    return {"ok": True, "image": urls[0], "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}


async def tool_edit_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic image-to-image edit without mask (variation / style shift)."""
    image_url = (args.get("image_url") or "").strip()
    if not image_url:
        return {"ok": False, "error": "image_url is required"}
    prompt = args.get("prompt") or "enhance clarity, keep composition"
    size = args.get("size", "1024x1024")
    quality = args.get("quality", "high")
    op_start = time.perf_counter()
    # source_article_id lets Agent imitate an image from one note and bind the
    # edited/variant result to another note.  article_id remains the write target.
    article_id = _optional_article_id(args.get("article_id"))
    source_article_id = _optional_article_id(args.get("source_article_id")) or article_id
    access_err = await _ensure_article_image_access(source_article_id, image_url)
    if access_err:
        return access_err
    try:
        urls = await _await_with_progress(
            edit_image(image_url, None, prompt, size=size, quality=quality, n=1),
            label="图片编辑",
            step="edit_image",
            data={"image_url": image_url, "size": size, "quality": quality},
        )
    except Exception as e:
        elapsed = _elapsed_ms(op_start)
        return {
            "ok": False,
            "error": _friendly_tool_error(e, elapsed_ms=elapsed, action="图片编辑"),
            "raw_error": str(e)[:1000],
            "timeout": _is_timeout_error(e),
            "elapsed_ms": elapsed,
            "elapsed_sec": round(elapsed / 1000, 2),
        }
    if not urls:
        return {"ok": False, "error": "no image returned"}
    bind_err = await _bind_image_to_article(
        urls[0],
        article_id,
        args.get("role", "content"),
        args.get("replace_index"),
    )
    if bind_err:
        return bind_err
    elapsed = _elapsed_ms(op_start)
    return {"ok": True, "image": urls[0], "elapsed_ms": elapsed, "elapsed_sec": round(elapsed / 1000, 2)}


# ---------- templates ----------

async def tool_list_templates(args: Dict[str, Any]) -> Dict[str, Any]:
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        q = select(Template).order_by(Template.id.asc())
        if uid is not None:
            q = q.where(or_(Template.creator_id.is_(None), Template.creator_id == uid))
        res = await s.execute(q)
        items = [t.to_dict() for t in res.scalars().all()]
    return {"ok": True, "items": items}


async def tool_apply_template(args: Dict[str, Any]) -> Dict[str, Any]:
    """Pick a template + topic -> generate article following that template."""
    template_id = args.get("template_id")
    topic = args.get("topic") or ""
    if not topic:
        return {"ok": False, "error": "topic is required"}
    async with SessionLocal() as s:
        tmpl = await s.get(Template, int(template_id)) if template_id else None
        if not tmpl:
            return {"ok": False, "error": "template not found"}
        uid = get_tool_user_id()
        if uid is not None and tmpl.creator_id is not None and tmpl.creator_id != uid:
            return {"ok": False, "error": "无权使用该模板"}
    resp = await chat_completion(
        messages=[
            {"role": "system", "content": XHS_WRITER_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"按模版创作一篇小红书笔记。\n模板名：{tmpl.name}\n模版骨架：\n{tmpl.body}\n"
                    f"主题：{topic}\n严格按系统要求 JSON 返回。"
                ),
            },
        ],
        temperature=0.8,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    title = _normalize_title(data.get("title"), topic)
    body = data.get("body") or ""
    tags = _normalize_tags(data.get("tags") or [])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


# ---------- search / batch / export / stats / schedule ----------

async def tool_search_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    """Full-text search articles by keyword, with optional status/tag filters."""
    keyword = args.get("keyword", "")
    status_filter = args.get("status")
    tag_filter = args.get("tag")
    limit = _safe_int(args.get("limit", 20), 20, min_value=1, max_value=100)
    uid = get_tool_user_id()

    async with SessionLocal() as s:
        q = select(Article).order_by(Article.updated_at.desc())
        if uid:
            q = q.where(Article.user_id == uid)
        if status_filter:
            q = q.where(Article.status == status_filter)
        if tag_filter:
            q = q.where(Article.tags.contains(tag_filter))
        res = await s.execute(q.limit(100))
        articles = res.scalars().all()

    results = []
    kw = keyword.lower()
    for a in articles:
        if kw and kw not in (a.title or "").lower() and kw not in (a.body or "").lower():
            continue
        results.append(_article_payload(a))
        if len(results) >= limit:
            break

    return {"ok": True, "count": len(results), "items": results}


async def tool_batch_score(args: Dict[str, Any]) -> Dict[str, Any]:
    """Score multiple articles and return a summary."""
    article_ids = args.get("article_ids") or []
    if not article_ids:
        return {"ok": False, "error": "article_ids is required"}

    results = []
    for aid in article_ids[:10]:
        r = await tool_score_article({"article_id": int(aid)})
        results.append({
            "article_id": int(aid),
            "ok": r.get("ok", False),
            "score": r.get("score", {}),
            "error": r.get("error"),
        })

    return {"ok": True, "results": results}


async def tool_batch_optimize(args: Dict[str, Any]) -> Dict[str, Any]:
    """Optimize multiple articles in sequence."""
    article_ids = args.get("article_ids") or []
    focus = args.get("focus", "标题吸引力、开头钩子、情绪价值、标签")
    if not article_ids:
        return {"ok": False, "error": "article_ids is required"}

    results = []
    for aid in article_ids[:5]:
        r = await tool_optimize_article({"article_id": int(aid), "focus": focus})
        results.append({"article_id": int(aid), "ok": r.get("ok", False), "error": r.get("error")})

    return {"ok": True, "results": results}


async def tool_export_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    """Export articles as JSON array with optional filters."""
    status_filter = args.get("status")
    tag_filter = args.get("tag")
    limit = _safe_int(args.get("limit", 50), 50, min_value=1, max_value=500)
    uid = get_tool_user_id()

    async with SessionLocal() as s:
        q = select(Article).order_by(Article.updated_at.desc())
        if uid:
            q = q.where(Article.user_id == uid)
        if status_filter:
            q = q.where(Article.status == status_filter)
        if tag_filter:
            q = q.where(Article.tags.contains(tag_filter))
        res = await s.execute(q.limit(limit))
        items = [_article_payload(a) for a in res.scalars().all()]

    return {"ok": True, "count": len(items), "articles": items}


async def tool_article_stats(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return aggregate stats: counts by status, average scores, tag distribution."""
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        q = select(Article)
        if uid:
            q = q.where(Article.user_id == uid)
        res = await s.execute(q)
        articles = res.scalars().all()

    total = len(articles)
    by_status: Dict[str, int] = {}
    tag_counts: Dict[str, int] = {}
    scores = []

    for a in articles:
        by_status[a.status] = by_status.get(a.status, 0) + 1
        if a.score and isinstance(a.score, dict) and "overall" in a.score:
            scores.append(a.score["overall"])
        for t in (a.tags or "").split(","):
            t = t.strip()
            if t:
                tag_counts[t] = tag_counts.get(t, 0) + 1

    avg_score = round(sum(scores) / len(scores), 1) if scores else None
    top_tags = sorted(tag_counts.items(), key=lambda x: -x[1])[:15]

    return {
        "ok": True,
        "total": total,
        "by_status": by_status,
        "scored_count": len(scores),
        "avg_score": avg_score,
        "top_tags": [{"tag": t, "count": c} for t, c in top_tags],
    }


async def tool_schedule_publish(args: Dict[str, Any]) -> Dict[str, Any]:
    """Mark an article for scheduled publish at a given datetime."""
    from ..time_utils import parse_beijing_datetime_to_naive

    aid = int(args["article_id"])
    scheduled_at_str = args.get("scheduled_at", "")

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        uid = get_tool_user_id()
        if uid is not None and art.user_id != uid:
            return {"ok": False, "error": "无权操作该笔记"}
        art.status = "scheduled"
        if scheduled_at_str:
            try:
                art.scheduled_at = parse_beijing_datetime_to_naive(scheduled_at_str)
            except ValueError:
                return {"ok": False, "error": f"invalid datetime: {scheduled_at_str}"}
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": _article_payload(art)}


# ---------- registry ----------

def _fn_schema(name: str, description: str, props: Dict[str, Any], required: List[str] | None = None) -> Dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": props,
                "required": required or [],
            },
        },
    }


TOOLS: Dict[str, Dict[str, Any]] = {
    "generate_article": {
        "fn": tool_generate_article,
        "schema": _fn_schema(
            "generate_article",
            "从主题从零生成一篇小红书风格笔记并入库。",
            {
                "topic": {"type": "string", "description": "主题或灵感"},
                "tone": {"type": "string"},
                "length": {"type": "string"},
                "audience": {"type": "string"},
                "extra": {"type": "string", "description": "补充要求、口吻、禁用点等"},
                "source_material": {"type": "string", "description": "原始素材/用户提供的信息，可包含产品、房源、服务、评价等"},
                "listing_info": {"type": "string", "description": "房源/民宿/酒店/产品的客观信息，用于原创提炼卖点"},
                "guest_reviews": {"type": "string", "description": "房客评价/用户评价/真实反馈，用于提炼体验证据和小红书口吻"},
            },
            required=["topic"],
        ),
    },
    "create_complete_note_workflow": {
        "fn": tool_create_complete_note_workflow,
        "schema": _fn_schema(
            "create_complete_note_workflow",
            "端到端创作工作流：只在用户明确要求生成完整笔记/帖子/草稿/一键成稿时使用。会解析 brief，生成笔记、标题候选、标签、首图/后续图方向，本地自检并可自动二次优化后入库。不要用于单纯生成图片/首图/海报。",
            {
                "topic": {"type": "string", "description": "主题、灵感或完整 brief"},
                "audience": {"type": "string", "description": "目标受众"},
                "tone": {"type": "string", "description": "语气/风格"},
                "length": {"type": "string", "description": "短/中等/长"},
                "extra": {"type": "string", "description": "补充要求、产品卖点、禁用表达等"},
                "source_material": {"type": "string", "description": "用户提供的原始素材；做原创时要从素材中提炼真实卖点，而不是泛泛扩写"},
                "listing_info": {"type": "string", "description": "房源/民宿/酒店/产品的客观信息，如位置、景观、设施、价格、交通、周边"},
                "guest_reviews": {"type": "string", "description": "房客评价/用户评价/真实反馈，用作体验证据和语气参考"},
                "auto_optimize": {"type": "boolean", "description": "是否基于自检自动二次优化，默认 true"},
                "include_visual_prompts": {"type": "boolean", "description": "是否产出首图和后续队列图片 prompt，默认 true"},
                "generate_cover": {"type": "boolean", "description": "是否直接生成展示队列第 1 张（首图），默认 false；与内容图只有队列位置区别"},
                "generate_content_images": {"type": "boolean", "description": "是否直接生成后续队列图片，默认 false；若未单独生成首图且队列为空，第一张生成图会成为首图"},
                "image_count": {"type": "integer", "description": "后续图片 prompt/生成数量，1-6"},
                "image_concurrency": {"type": "integer", "description": "后续图片并发生成数量，1-4，默认 3"},
                "image_size": {"type": "string", "description": "用户指定的图片尺寸/分辨率，如 1536x2048、2K、4K；未指定默认 1152x1536"},
                "image_ratio": {"type": "string", "description": "用户指定比例，如 3:4、16:9、1:1；未指定默认 3:4"},
            },
            required=["topic"],
        ),
    },
    "rewrite_article": {
        "fn": tool_rewrite_article,
        "schema": _fn_schema(
            "rewrite_article",
            "对指定 article_id 的笔记整体改写并写回。",
            {
                "article_id": {"type": "integer"},
                "style": {"type": "string", "description": "改写后的风格，如更口语化、更小红书、更种草、更真实体验感"},
                "instruction": {"type": "string", "description": "改写要求。改写会重构标题/开头/段落/结尾，降低原帖连续文本/关键词重复，避免缩写式改写。"},
            },
            required=["article_id"],
        ),
    },
    "imitate_article_style": {
        "fn": tool_imitate_article_style,
        "schema": _fn_schema(
            "imitate_article_style",
            "参考某篇笔记的中文小红书写法/结构/视觉风格做仿写。可写回目标笔记或新建笔记；需要仿图时会用 edit_image 基于参考图生成同风格变体并绑定。",
            {
                "reference_article_id": {"type": "integer", "description": "作为风格参考的笔记 ID"},
                "target_article_id": {"type": "integer", "description": "要写回的目标笔记 ID；不传则新建笔记"},
                "topic": {"type": "string", "description": "新主题/选题；为空时沿用目标笔记或参考笔记同赛道"},
                "instruction": {"type": "string", "description": "额外仿写要求、受众、禁用点等"},
                "generate_images": {"type": "boolean", "description": "是否同时仿图，默认 false"},
                "image_count": {"type": "integer", "description": "仿图数量 0-6"},
                "image_mode": {"type": "string", "enum": ["edit_reference", "generate"], "description": "edit_reference=调用 edit_image 修改参考图做同风格变体；generate=参考图生图"},
                "size": {"type": "string", "description": "仿图尺寸，默认 1152x1536；可按用户 2K/4K/3:4/16:9 要求推断"},
                "quality": {"type": "string", "enum": ["high", "medium", "low", "auto"]},
            },
            required=["reference_article_id"],
        ),
    },
    "optimize_article": {
        "fn": tool_optimize_article,
        "schema": _fn_schema(
            "optimize_article",
            "对指定笔记做局部优化（标题/钩子/标签等），返回 changelog。",
            {"article_id": {"type": "integer"}, "focus": {"type": "string"}},
            required=["article_id"],
        ),
    },
    "polish_paragraph": {
        "fn": tool_polish_paragraph,
        "schema": _fn_schema(
            "polish_paragraph",
            "润色一段文字，返回润色后的段落文本。",
            {"paragraph": {"type": "string"}, "style": {"type": "string"}},
            required=["paragraph"],
        ),
    },
    "score_article": {
        "fn": tool_score_article,
        "schema": _fn_schema(
            "score_article",
            "对笔记进行五维度打分并写回，会结合正文、标签、首图/后续图片数量和 image_context 评估 visual。",
            {"article_id": {"type": "integer"}},
            required=["article_id"],
        ),
    },
    "diagnose_article": {
        "fn": tool_diagnose_article,
        "schema": _fn_schema(
            "diagnose_article",
            "发布前深度诊断：内容、视觉、增长、用户反应、违禁词、CTA 和图文匹配；会把首图/后续图片传给视觉诊断 Agent（模型不支持图片时自动退化为 URL/数量判断）。",
            {"article_id": {"type": "integer"}},
            required=["article_id"],
        ),
    },
    "create_article": {
        "fn": tool_create_article,
        "schema": _fn_schema(
            "create_article",
            "创建一条空白或指定内容的笔记。",
            {
                "title": {"type": "string"},
                "body": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
        ),
    },
    "update_article": {
        "fn": tool_update_article,
        "schema": _fn_schema(
            "update_article",
            "更新笔记字段（部分字段可选）。",
            {
                "article_id": {"type": "integer"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "cover_image": {"type": "string"},
                "images": {"type": "array", "items": {"type": "string"}},
                "status": {"type": "string"},
            },
            required=["article_id"],
        ),
    },
    "read_article": {
        "fn": tool_read_article,
        "schema": _fn_schema(
            "read_article",
            "读取指定笔记完整详情，包含正文、标签、状态、score、cover_image、images、image_context（图片角色/索引/尺寸元数据）和 content_stats。",
            {"article_id": {"type": "integer"}},
            required=["article_id"],
        ),
    },
    "list_articles": {
        "fn": tool_list_articles,
        "schema": _fn_schema(
            "list_articles",
            "列出最近的笔记。",
            {"limit": {"type": "integer"}},
        ),
    },
    "delete_article": {
        "fn": tool_delete_article,
        "schema": _fn_schema(
            "delete_article",
            "删除指定笔记。",
            {"article_id": {"type": "integer"}},
            required=["article_id"],
        ),
    },
    "generate_image": {
        "fn": tool_generate_image,
        "schema": _fn_schema(
            "generate_image",
            "独立生成真实图片，不会创建笔记/帖子。只有用户明确要求“生成图片/生成首图/生成封面图/出图/生图/画一张/制作海报”时使用；“封面方向/封面建议/配图方向/视觉方案/prompt”只是文字方案，不要用本工具；不确定时优先一次性反问清楚是否真实出图、数量/尺寸、是否绑定笔记；若只缺一个关键点，可只问一个。只有在显式传 article_id 时才绑定到笔记（role=cover|content）；role=cover 表示放到展示队列第 1 位，role=content 表示后续队列图；若指定 replace_index，则替换后续队列图。",
            {
                "prompt": {"type": "string"},
                "size": {"type": "string", "description": "如 1152x1536 / 1536x2048 / 2048x1152；不传时会从 prompt 的 2K/4K/比例推断，默认 3:4"},
                "quality": {
                    "type": "string",
                    "enum": ["high", "medium", "low", "auto"],
                    "description": "生成质量，默认 high（最高）",
                },
                "n": {"type": "integer"},
                "reference_images": {"type": "array", "items": {"type": "string"}},
                "article_id": {"type": "integer", "description": "仅当用户明确要求绑定到某篇笔记时传；独立生成图片时不要传，也不要传 0"},
                "role": {"type": "string", "enum": ["cover", "content"], "description": "仅绑定到笔记时传；cover=展示队列第 1 张，content=后续队列图"},
                "replace_index": {"type": "integer", "description": "仅绑定到笔记时传；替换第 N 张后续队列图（0-based）"},
            },
            required=["prompt"],
        ),
    },
    "remove_image": {
        "fn": tool_remove_image,
        "schema": _fn_schema(
            "remove_image",
            "删除笔记展示队列中的首图或某张后续图片。",
            {
                "article_id": {"type": "integer"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "index": {"type": "integer", "description": "role=content 时的 0-based 下标，省略表示清空全部"},
            },
            required=["article_id"],
        ),
    },
    "arrange_article_images": {
        "fn": tool_arrange_article_images,
        "schema": _fn_schema(
            "arrange_article_images",
            "编排笔记图片队列：第 1 张就是小红书首图/封面。可把某张图设为封面、移动到第 N 张、插入、替换、删除或按完整 order 重排。",
            {
                "article_id": {"type": "integer"},
                "action": {
                    "type": "string",
                    "enum": ["set_order", "move", "set_cover", "insert", "replace", "remove", "clear"],
                    "description": "set_order=按 order 完整重排；move=from_position 移到 to_position；set_cover=position/image_url 设为首图；insert/replace/remove/clear 如名",
                },
                "order": {"type": "array", "items": {"type": "string"}, "description": "完整展示队列，order[0] 会成为封面"},
                "image_url": {"type": "string", "description": "insert/replace/set_cover/remove 可用"},
                "from_position": {"type": "integer", "description": "0-based 展示位置；0 是封面"},
                "to_position": {"type": "integer", "description": "0-based 展示位置；0 是封面"},
                "position": {"type": "integer", "description": "0-based 展示位置；0 是封面"},
            },
            required=["article_id", "action"],
        ),
    },
    "content_image_prompt": {
        "fn": tool_content_image_prompt,
        "schema": _fn_schema(
            "content_image_prompt",
            "根据笔记正文产出 3-5 条分段配图 prompt。",
            {
                "article_id": {"type": "integer"},
                "topic": {"type": "string"},
                "title": {"type": "string"},
                "body": {"type": "string"},
                "n": {"type": "integer"},
            },
        ),
    },
    "generate_article_images": {
        "fn": tool_generate_article_images,
        "schema": _fn_schema(
            "generate_article_images",
            "为已有笔记并发生成小红书展示队列图片并自动绑定。include_cover 只代表是否单独生成队列第 1 张（首图）；content_count 代表后续队列图片数量。适合“给这篇笔记生成多张配图/按段落生成图片/补齐帖子图片”。会实时回报耗时与失败项。",
            {
                "article_id": {"type": "integer"},
                "include_cover": {"type": "boolean", "description": "是否单独生成/替换展示队列第 1 张（首图），默认 false"},
                "content_count": {"type": "integer", "description": "后续队列图片数量，0-8，默认 4；若没有首图且不生成首图，第一张生成图会作为首图"},
                "concurrency": {"type": "integer", "description": "并发数量，1-4，默认 3"},
                "replace_existing": {"type": "boolean", "description": "是否替换已有后续队列图片；false 为追加"},
                "size": {"type": "string", "description": "后续队列图片尺寸，默认 1152x1536；可从 2K/4K/比例推断"},
                "cover_size": {"type": "string", "description": "队列第 1 张尺寸，默认 1152x1536；可从 2K/4K/比例推断"},
                "quality": {"type": "string", "enum": ["high", "medium", "low", "auto"]},
                "style": {"type": "string"},
                "cover_prompt": {"type": "string"},
                "shots": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "scene": {"type": "string"},
                            "prompt": {"type": "string"},
                            "size": {"type": "string"},
                            "quality": {"type": "string"},
                        },
                    },
                },
            },
            required=["article_id"],
        ),
    },
    "crop_image": {
        "fn": tool_crop_image,
        "schema": _fn_schema(
            "crop_image",
            "按像素盒裁剪图片，可直接写回笔记（role=cover|content + replace_index）。",
            {
                "image_url": {"type": "string"},
                "x": {"type": "integer"},
                "y": {"type": "integer"},
                "w": {"type": "integer"},
                "h": {"type": "integer"},
                "article_id": {"type": "integer"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "replace_index": {"type": "integer"},
            },
            required=["image_url", "x", "y", "w", "h"],
        ),
    },
    "inpaint_image": {
        "fn": tool_inpaint_image,
        "schema": _fn_schema(
            "inpaint_image",
            "局部重绘：在 mask 透明区域按 prompt 生成新内容。必须提供 mask_url；没有蒙版时先让用户上传/涂抹，不要强行调用。article_id/source ID 只能传真实笔记 ID，独立编辑不要传 0。",
            {
                "image_url": {"type": "string"},
                "mask_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "quality": {
                    "type": "string",
                    "enum": ["high", "medium", "low", "auto"],
                    "description": "生成质量，默认 high（最高）",
                },
                "article_id": {"type": "integer", "description": "可选真实笔记 ID；独立图片编辑不要传 0/空值"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "replace_index": {"type": "integer"},
            },
            required=["image_url", "mask_url", "prompt"],
        ),
    },
    "remove_object": {
        "fn": tool_remove_object,
        "schema": _fn_schema(
            "remove_object",
            "消除：在 mask 透明区域自动填充和周围环境一致的内容，用来擦除物体/水印/路人。必须提供 mask_url；没有蒙版时先让用户上传/涂抹，不要强行调用。",
            {
                "image_url": {"type": "string"},
                "mask_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "quality": {
                    "type": "string",
                    "enum": ["high", "medium", "low", "auto"],
                    "description": "生成质量，默认 high（最高）",
                },
                "article_id": {"type": "integer", "description": "可选真实笔记 ID；独立图片编辑不要传 0/空值"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "replace_index": {"type": "integer"},
            },
            required=["image_url", "mask_url"],
        ),
    },
    "edit_image": {
        "fn": tool_edit_image,
        "schema": _fn_schema(
            "edit_image",
            "整图风格化编辑（不带 mask），用于同风格变体、清晰度增强、改色调、整体风格调整。可用 source_article_id 指明原图归属，再把结果绑定到另一个真实 article_id；独立编辑不要传 article_id=0。",
            {
                "image_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "quality": {
                    "type": "string",
                    "enum": ["high", "medium", "low", "auto"],
                    "description": "生成质量，默认 high（最高）",
                },
                "source_article_id": {"type": "integer", "description": "原图所属真实笔记 ID；用于跨笔记仿图/改图权限校验，独立图片可不传"},
                "article_id": {"type": "integer", "description": "写回目标真实笔记 ID；独立图片编辑不要传 0/空值"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "replace_index": {"type": "integer"},
            },
            required=["image_url", "prompt"],
        ),
    },
    "suggest_tags": {
        "fn": tool_suggest_tags,
        "schema": _fn_schema(
            "suggest_tags",
            "根据主题或正文给出小红书高流量标签。",
            {"topic": {"type": "string"}, "body": {"type": "string"}},
        ),
    },
    "suggest_titles": {
        "fn": tool_suggest_titles,
        "schema": _fn_schema(
            "suggest_titles",
            "给一批候选标题供选择。",
            {"topic": {"type": "string"}, "body": {"type": "string"}, "n": {"type": "integer"}},
        ),
    },
    "outline_article": {
        "fn": tool_outline_article,
        "schema": _fn_schema(
            "outline_article",
            "产出笔记大纲（钩子/分段/CTA）。",
            {"topic": {"type": "string"}, "audience": {"type": "string"}},
            required=["topic"],
        ),
    },
    "cover_prompt": {
        "fn": tool_cover_prompt,
        "schema": _fn_schema(
            "cover_prompt",
            "根据主题/标题产出首图/封面方向、构图、配色和 gpt-image-2 prompt；只返回文字方案，不实际生成图片。适合“封面方向/封面建议/视觉方案”。",
            {"topic": {"type": "string"}, "title": {"type": "string"}, "style": {"type": "string"}},
        ),
    },
    "list_templates": {
        "fn": tool_list_templates,
        "schema": _fn_schema("list_templates", "列出笔记模板。", {}),
    },
    "apply_template": {
        "fn": tool_apply_template,
        "schema": _fn_schema(
            "apply_template",
            "按指定模板生成一篇笔记并入库。",
            {"template_id": {"type": "integer"}, "topic": {"type": "string"}},
            required=["template_id", "topic"],
        ),
    },
    "search_articles": {
        "fn": tool_search_articles,
        "schema": _fn_schema(
            "search_articles",
            "按关键词搜索笔记，可按状态/标签过滤。",
            {
                "keyword": {"type": "string", "description": "搜索关键词（标题或正文）"},
                "status": {"type": "string", "description": "按状态过滤：draft/published/scheduled"},
                "tag": {"type": "string", "description": "按标签过滤"},
                "limit": {"type": "integer"},
            },
        ),
    },
    "batch_score": {
        "fn": tool_batch_score,
        "schema": _fn_schema(
            "batch_score",
            "批量打分多篇笔记（最多 10 篇），返回各自评分。",
            {"article_ids": {"type": "array", "items": {"type": "integer"}, "description": "笔记 ID 列表"}},
            required=["article_ids"],
        ),
    },
    "batch_optimize": {
        "fn": tool_batch_optimize,
        "schema": _fn_schema(
            "batch_optimize",
            "批量优化多篇笔记（最多 5 篇）。",
            {
                "article_ids": {"type": "array", "items": {"type": "integer"}, "description": "笔记 ID 列表"},
                "focus": {"type": "string", "description": "优化重点"},
            },
            required=["article_ids"],
        ),
    },
    "export_articles": {
        "fn": tool_export_articles,
        "schema": _fn_schema(
            "export_articles",
            "导出笔记为 JSON（可按状态/标签过滤）。",
            {
                "status": {"type": "string"},
                "tag": {"type": "string"},
                "limit": {"type": "integer"},
            },
        ),
    },
    "article_stats": {
        "fn": tool_article_stats,
        "schema": _fn_schema(
            "article_stats",
            "返回笔记统计：各状态数量、平均分、标签分布。",
            {},
        ),
    },
    "schedule_publish": {
        "fn": tool_schedule_publish,
        "schema": _fn_schema(
            "schedule_publish",
            "设置笔记定时发布（状态改为 scheduled + 设置发布时间）。",
            {
                "article_id": {"type": "integer"},
                "scheduled_at": {"type": "string", "description": "ISO 格式时间，如 2025-01-15T09:00:00"},
            },
            required=["article_id"],
        ),
    },
}


def openai_tool_schemas() -> List[Dict[str, Any]]:
    return [t["schema"] for t in TOOLS.values()]


async def call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name not in TOOLS:
        return {"ok": False, "error": f"unknown tool: {name}"}
    fn: ToolFn = TOOLS[name]["fn"]
    return await fn(args or {})


async def call_tool_for_user(
    name: str,
    args: Dict[str, Any],
    user_id: Optional[int],
    settings: Optional[Any] = None,
) -> Dict[str, Any]:
    """Call a tool with user ownership and per-user LLM settings bound.

    This is the single entrypoint REST routes should use. The standalone stdio
    MCP server intentionally calls `call_tool` without a user to preserve local
    single-user compatibility.
    """
    from ..config import get_effective_settings

    settings = settings if settings is not None else (await get_effective_settings(user_id) if user_id else None)
    user_token = set_tool_user_id(user_id)
    settings_token = set_current_settings(settings)
    try:
        return await call_tool(name, args or {})
    finally:
        reset_current_settings(settings_token)
        reset_tool_user_id(user_token)
