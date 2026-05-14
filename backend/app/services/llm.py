from __future__ import annotations

import base64
import contextvars
import io
import ipaddress
import json
import re
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from openai import AsyncOpenAI

from ..config import Settings, get_settings


_clients: Dict[tuple, AsyncOpenAI] = {}
_current_settings: contextvars.ContextVar[Optional[Settings]] = contextvars.ContextVar(
    "_current_llm_settings", default=None
)
DEFAULT_LLM_TIMEOUT_SECONDS = 180.0
IMAGE_GENERATION_TIMEOUT_SECONDS = 8 * 60.0
# Compatibility upload probes should fail quickly on gateways that do not support
# images.edit uploads, while full image generation/edit requests keep the 8 min cap.
IMAGE_EDIT_COMPAT_TIMEOUT_SECONDS = 25.0
VISION_IMAGE_DETAIL = "auto"
VISION_REMOTE_FETCH_TIMEOUT_SECONDS = 20.0
REMOTE_IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 60.0
REMOTE_IMAGE_MAX_BYTES = 50 * 1024 * 1024
IMAGE_MIN_SIDE = 64
IMAGE_MAX_SIDE = 4096
IMAGE_MAX_PIXELS = IMAGE_MAX_SIDE * IMAGE_MAX_SIDE
IMAGE_SIZE_RE = re.compile(r"^\s*(\d{2,5})\s*x\s*(\d{2,5})\s*$", re.IGNORECASE)
IMAGE_MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def set_current_settings(settings: Optional[Settings]) -> contextvars.Token:
    """Bind effective LLM settings to the current async context.

    Tool calls can be triggered from REST, SSE background tasks, or MCP. Binding
    settings here keeps nested calls (diagnosis agents, image tools, etc.) on the
    same per-user model/API key without threading a parameter through every tool.
    """
    return _current_settings.set(settings)


def reset_current_settings(token: contextvars.Token) -> None:
    _current_settings.reset(token)


def get_current_settings() -> Optional[Settings]:
    """Return settings bound to the current async tool/agent context, if any."""
    return _current_settings.get()


def _effective_settings(settings: Optional[Settings] = None) -> Settings:
    return settings or _current_settings.get() or get_settings()


def reset_client() -> None:
    _clients.clear()


def _client_credentials(s: Settings, kind: str = "chat") -> Tuple[str, str]:
    if kind == "image":
        return s.effective_image_api_key, s.effective_image_base_url
    return s.effective_chat_api_key, s.effective_chat_base_url


def get_client(settings: Optional[Settings] = None, kind: str = "chat") -> AsyncOpenAI:
    s = settings or get_settings()
    api_key, base_url = _client_credentials(s, kind)
    key = (kind, api_key, base_url)
    if key not in _clients:
        _clients[key] = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=IMAGE_GENERATION_TIMEOUT_SECONDS if kind == "image" else DEFAULT_LLM_TIMEOUT_SECONDS,
        )
    return _clients[key]


def _normalize_image_quality(quality: Optional[str], model: str = "") -> str:
    """Normalize quality while keeping "highest" as the default.

    GPT image models support high/medium/low/auto. DALL·E models use older
    quality values, so map the highest setting to each model family's best
    supported value.
    """
    q = (quality or "high").strip().lower()
    aliases = {
        "": "high",
        "best": "high",
        "highest": "high",
        "max": "high",
        "高清": "high",
        "最高": "high",
        "高": "high",
        "中": "medium",
        "低": "low",
    }
    q = aliases.get(q, q)
    m = (model or "").lower()
    if m.startswith("dall-e-2"):
        return "standard"
    if m.startswith("dall-e-3"):
        return "hd" if q in {"high", "hd"} else "standard"
    if q not in {"auto", "high", "medium", "low", "hd", "standard"}:
        return "high"
    # GPT image models: highest is high. If a caller passes DALL-E style hd,
    # treat it as the equivalent high setting.
    return "high" if q == "hd" else q


def _normalize_image_size(size: Optional[str]) -> str:
    value = str(size or "1152x1536").strip().lower()
    m = IMAGE_SIZE_RE.match(value)
    if not m:
        raise ValueError(f"图片尺寸格式无效：{size!r}，应为 1152x1536 这类 宽x高")
    w, h = int(m.group(1)), int(m.group(2))
    if w < IMAGE_MIN_SIDE or h < IMAGE_MIN_SIDE:
        raise ValueError(f"图片尺寸过小：{w}x{h}，单边不能小于 {IMAGE_MIN_SIDE}")
    if w > IMAGE_MAX_SIDE or h > IMAGE_MAX_SIDE or w * h > IMAGE_MAX_PIXELS:
        raise ValueError(
            f"图片尺寸过大：{w}x{h}，单边不超过 {IMAGE_MAX_SIDE}，总像素不超过 {IMAGE_MAX_PIXELS}"
        )
    return f"{w}x{h}"


def _normalize_image_count(n: Any) -> int:
    try:
        value = int(n)
    except Exception:
        value = 1
    return max(1, min(4, value))


def _has_images(messages: List[Dict[str, Any]]) -> bool:
    for m in messages:
        if m.get("images"):
            return True
    return False


def _is_private_or_local_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").strip().lower()
        if not host:
            return False
        if host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".local"):
            return True
        try:
            ip = ipaddress.ip_address(host)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved
        except ValueError:
            return False
    except Exception:
        return False


def _is_http_url(value: str) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlparse(value.strip())
        return parsed.scheme.lower() in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def _is_public_remote_url(value: str) -> bool:
    return _is_http_url(value) and not _is_private_or_local_url(value)


def _configured_public_base_url(settings: Optional[Settings] = None) -> str:
    s = settings or get_settings()
    base = (getattr(s, "public_base_url", "") or "").strip().rstrip("/")
    if not base:
        return ""
    parsed = urlparse(base)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return ""
    return base


def _configured_public_base_parts(settings: Optional[Settings] = None) -> Optional[Tuple[str, str, str]]:
    """Return normalized (scheme, netloc, path_prefix) for PUBLIC_BASE_URL."""
    base = _configured_public_base_url(settings)
    if not base:
        return None
    parsed = urlparse(base)
    return parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip("/")


def _local_static_path_part(url_or_path: str, settings: Optional[Settings] = None) -> Optional[str]:
    """Return /static/images/... for a local image reference, if safely identifiable."""
    value = str(url_or_path or "").strip()
    if not value:
        return None
    if value.startswith("/static/images/"):
        return value
    if _is_http_url(value):
        parsed = urlparse(value)
        if _is_private_or_local_url(value) and parsed.path.startswith("/static/images/"):
            return parsed.path
        public_base = _configured_public_base_parts(settings)
        if public_base:
            base_scheme, base_netloc, base_path = public_base
            url_path = parsed.path or ""
            expected_prefix = f"{base_path}/static/images/" if base_path else "/static/images/"
            if (
                parsed.scheme.lower() == base_scheme
                and parsed.netloc.lower() == base_netloc
                and url_path.startswith(expected_prefix)
            ):
                rel = url_path[len(expected_prefix):].lstrip("/")
                if rel:
                    return f"/static/images/{rel}"
        return None
    try:
        s = settings or get_settings()
        base = Path(s.image_dir).resolve()
        p = Path(value)
        candidate = p.resolve() if p.is_absolute() else (base / p.name).resolve()
        if candidate.is_relative_to(base):
            rel = candidate.relative_to(base).as_posix()
            return f"/static/images/{rel}"
    except Exception:
        return None
    return None


def _is_app_static_image_reference(url_or_path: str, settings: Optional[Settings] = None) -> bool:
    """True for this app's local/static image references, including deployed public URLs."""
    return _local_static_path_part(url_or_path, settings) is not None


def _public_url_for_local_image(url_or_path: str, settings: Optional[Settings] = None) -> Optional[str]:
    """Convert local /static/images/... to deployed public absolute URL when configured."""
    base = _configured_public_base_url(settings)
    if not base:
        return None
    path = _local_static_path_part(url_or_path, settings)
    if not path:
        return None
    return urljoin(base + "/", path.lstrip("/"))


def _provider_image_url(url_or_path: str, settings: Optional[Settings] = None) -> Optional[str]:
    """URL that an upstream provider can fetch directly, if available."""
    value = str(url_or_path or "").strip()
    # App-owned static images should be canonicalized through PUBLIC_BASE_URL
    # before treating them as arbitrary public remote URLs. This keeps deployed
    # /static/images references recoverable for local-upload fallback.
    public_url = _public_url_for_local_image(value, settings)
    if public_url:
        return public_url
    if _is_public_remote_url(value):
        return value
    return None


def _mime_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


def _extension_for_mime(mime: str, fallback_path: str = "") -> str:
    mime = (mime or "").split(";", 1)[0].strip().lower()
    if mime in IMAGE_MIME_TO_EXT:
        return IMAGE_MIME_TO_EXT[mime]
    suffix = Path(urlparse(fallback_path).path or fallback_path).suffix.lower()
    return suffix if suffix in {".png", ".jpg", ".jpeg", ".webp", ".gif"} else ".png"


def _original_image_data_url(data: bytes, *, source_name: str = "image", mime: Optional[str] = None) -> str:
    """Inline original image bytes without resizing/re-encoding.

    The user explicitly prefers no quality loss.  This preserves original
    pixels/format for vision input; the trade-off is a larger request payload
    when we cannot pass a public URL directly.
    """
    if not mime:
        mime = _mime_for_path(Path(source_name))
    b64 = base64.b64encode(data).decode()
    return f"data:{mime};base64,{b64}"


def _decode_b64_image_payload(payload: str) -> Tuple[bytes, str]:
    """Decode either raw b64_json or a data:image/...;base64 payload."""
    text = str(payload or "").strip()
    ext = ".png"
    if text.startswith("data:"):
        header, sep, body = text.partition(",")
        if not sep:
            raise ValueError("invalid image data URL")
        mime = header[5:].split(";", 1)[0]
        ext = _extension_for_mime(mime)
        text = body
    return base64.b64decode(text), ext


async def _fetch_remote_image_bytes(
    url: str,
    *,
    timeout: float,
    max_bytes: int = REMOTE_IMAGE_MAX_BYTES,
) -> Tuple[bytes, Optional[str]]:
    """Fetch an image URL with type/size validation and no re-encoding."""
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as hc:
        async with hc.stream("GET", url) as r:
            r.raise_for_status()
            content_type = (r.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
            if content_type and not content_type.startswith("image/"):
                raise ValueError(f"remote URL is not an image: {content_type}")
            content_length = r.headers.get("content-length")
            if content_length:
                try:
                    if int(content_length) > max_bytes:
                        raise ValueError(f"remote image too large: {content_length} bytes")
                except ValueError as e:
                    if "too large" in str(e):
                        raise
            chunks: List[bytes] = []
            total = 0
            async for chunk in r.aiter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise ValueError(f"remote image too large: >{max_bytes} bytes")
                chunks.append(chunk)
    if not chunks:
        raise ValueError("remote image is empty")
    return b"".join(chunks), (content_type or None)


async def _remote_image_to_data_url(url: str) -> str:
    data, mime = await _fetch_remote_image_bytes(
        url,
        timeout=VISION_REMOTE_FETCH_TIMEOUT_SECONDS,
        max_bytes=REMOTE_IMAGE_MAX_BYTES,
    )
    return _original_image_data_url(
        data,
        source_name=urlparse(url).path or "remote.jpg",
        mime=mime,
    )


async def _download_remote_image_to_local(url: str, settings: Settings, *, suffix: str = "remote") -> Path:
    """Download a remote image URL into image_dir without changing bytes/quality."""
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    data, content_type = await _fetch_remote_image_bytes(
        url,
        timeout=REMOTE_IMAGE_DOWNLOAD_TIMEOUT_SECONDS,
        max_bytes=REMOTE_IMAGE_MAX_BYTES,
    )
    ext = _extension_for_mime(content_type or "", url)
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}_{suffix}{ext}"
    out_path = Path(settings.image_dir) / name
    out_path.write_bytes(data)
    return out_path


async def _ensure_local_image_path(
    url_or_path: str,
    settings: Settings,
    *,
    suffix: str = "remote",
    allow_remote_download: bool = False,
) -> Path:
    if _is_http_url(url_or_path):
        # Local/private static URLs point back to this service; resolve them to
        # disk instead of asking an upstream image provider to fetch them.
        static_path = _local_static_path_part(url_or_path, settings)
        if static_path:
            return _resolve_local_path(static_path)
        # Only fetch remote URLs when explicitly requested. Public URLs should
        # stay as URLs so compatible providers can read them directly without
        # creating extra local copies.
        if allow_remote_download:
            return await _download_remote_image_to_local(url_or_path, settings, suffix=suffix)
        raise ValueError(f"external image URL should be passed through, not downloaded: {url_or_path}")
    return _resolve_local_path(url_or_path)


async def _to_vision_image_url(
    url: str,
    *,
    inline_remote: bool = False,
    settings: Optional[Settings] = None,
) -> str:
    """Return a provider-ready image_url value.

    Strategy:
    - public http(s): pass the URL directly first, closest to official clients
      and avoids huge base64 payloads.
    - local/private/data/local-file: inline original bytes as data URL so the
      model provider can actually read pixels without quality loss.
    - retry path can set inline_remote=True to fetch public images server-side
      and send original data URL if the provider cannot fetch external URLs.
    """
    if not url:
        return url
    if url.startswith("data:"):
        return url
    if _is_http_url(url):
        public_url = _public_url_for_local_image(url, settings)
        if public_url and not inline_remote:
            return public_url
        if inline_remote or _is_private_or_local_url(url):
            return await _remote_image_to_data_url(url)
        return url
    public_url = _public_url_for_local_image(url, settings)
    if public_url and not inline_remote:
        return public_url
    path = _resolve_local_path(url)
    if not path.exists():
        return url
    return _original_image_data_url(path.read_bytes(), source_name=path.name, mime=_mime_for_path(path))


async def to_openai_messages(
    messages: List[Dict[str, Any]],
    *,
    inline_remote_images: bool = False,
    settings: Optional[Settings] = None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")
        images = m.get("images") or []

        # tool / assistant messages shouldn't be mangled
        if role == "tool":
            payload: Dict[str, Any] = {
                "role": "tool",
                "content": content if isinstance(content, str) else str(content),
            }
            if m.get("tool_call_id"):
                payload["tool_call_id"] = m["tool_call_id"]
            out.append(payload)
            continue

        if role == "assistant":
            payload = {"role": "assistant", "content": content}
            if m.get("tool_calls"):
                payload["tool_calls"] = m["tool_calls"]
            out.append(payload)
            continue

        if images and role == "user":
            parts: List[Dict[str, Any]] = []
            if content:
                parts.append({"type": "text", "text": content})
            # Tell the LLM the local paths so it can pass them to image editing tools
            path_hints = "\n".join(f"[图片路径: {url}]" for url in images)
            parts.append({"type": "text", "text": path_hints})
            for url in images:
                parts.append(
                    {
                        "type": "image_url",
                            "image_url": {
                            "url": await _to_vision_image_url(
                                str(url),
                                inline_remote=inline_remote_images,
                                settings=settings,
                            ),
                            "detail": VISION_IMAGE_DETAIL,
                        },
                    }
                )
            out.append({"role": role, "content": parts})
        else:
            out.append({"role": role, "content": content})
    return out


def _should_retry_inline_images(exc: BaseException) -> bool:
    text = f"{type(exc).__name__}: {exc}".lower()
    return any(
        needle in text
        for needle in (
            "image",
            "url",
            "fetch",
            "download",
            "unsupported",
            "invalid",
            "400",
            "422",
        )
    )


async def chat_completion(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    temperature: float = 0.7,
    model: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Any:
    s = _effective_settings(settings)
    client = get_client(s, kind="chat")
    kwargs: Dict[str, Any] = {
        "model": model or s.chat_model,
        "messages": await to_openai_messages(messages, settings=s),
        "temperature": temperature,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice
    try:
        return await client.chat.completions.create(**kwargs)
    except Exception as e:
        # Public image URLs are optimal when the provider can fetch them.  Some
        # OpenAI-compatible gateways cannot, so retry once by fetching the image
        # server-side and sending the original bytes as a data URL instead.
        if not _has_images(messages) or not _should_retry_inline_images(e):
            raise
        kwargs["messages"] = await to_openai_messages(messages, inline_remote_images=True, settings=s)
        return await client.chat.completions.create(**kwargs)


async def chat_completion_stream(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    temperature: float = 0.7,
    model: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> AsyncIterator[Any]:
    s = _effective_settings(settings)
    client = get_client(s, kind="chat")
    kwargs: Dict[str, Any] = {
        "model": model or s.chat_model,
        "messages": await to_openai_messages(messages, settings=s),
        "temperature": temperature,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    try:
        stream = await client.chat.completions.create(**kwargs)
    except Exception as e:
        if not _has_images(messages) or not _should_retry_inline_images(e):
            raise
        kwargs["messages"] = await to_openai_messages(messages, inline_remote_images=True, settings=s)
        stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        yield chunk


async def generate_image(
    prompt: str,
    size: str = "1152x1536",
    n: int = 1,
    quality: str = "high",
    reference_images: Optional[List[str]] = None,
    settings: Optional[Settings] = None,
) -> List[str]:
    s = _effective_settings(settings)
    size = _normalize_image_size(size)
    n = _normalize_image_count(n)
    quality = _normalize_image_quality(quality, s.image_model)
    if reference_images:
        refs = [str(x).strip() for x in reference_images if str(x or "").strip()]
        if not refs:
            refs = []
        provider_refs = [_provider_image_url(ref, s) for ref in refs]
        if refs and all(provider_refs):
            # Public external URLs and deployed /static/images URLs are
            # provider-readable in many compatible gateways. Keep them as URLs
            # first; do not download/copy them into image_dir.
            url_refs = [str(x) for x in provider_refs if x]
            try:
                return await _generate_image_raw_http(
                    settings=s,
                    prompt=prompt,
                    size=size,
                    n=n,
                    quality=quality,
                    reference_images=url_refs,
                )
            except Exception as e:
                # Some gateways model "reference image" as an edit endpoint
                # with image_url instead of a generations reference_images
                # field.  Try that URL-native shape before surfacing the error.
                try:
                    return await _edit_image_url_raw_http(
                        settings=s,
                        image_url=url_refs[0],
                        mask_url=None,
                        prompt=prompt,
                        size=size,
                        n=n,
                        quality=quality,
                    )
                except Exception as edit_e:
                    # For local /static images on a deployed app, URL-native is
                    # just an optimization. If the provider rejects URL edits,
                    # fall back to the SDK upload path. For true external URLs,
                    # keep the user's preference: do not download them.
                    if _is_app_static_image_reference(refs[0], s):
                        return await edit_image(
                            image_url=refs[0],
                            mask_url=None,
                            prompt=prompt,
                            size=size,
                            n=n,
                            quality=quality,
                            settings=s,
                        )
                    raise RuntimeError(
                        "图片生成失败：上游未接受外部参考图 URL；"
                        f"generations 失败: {e}; edits 失败: {edit_e}"
                    ) from edit_e
        if refs:
            return await edit_image(
                image_url=refs[0],
                mask_url=None,
                prompt=prompt,
                size=size,
                n=n,
                quality=quality,
                settings=s,
            )
    client = get_client(s, kind="image")
    Path(s.image_dir).mkdir(parents=True, exist_ok=True)

    try:
        resp = await client.images.generate(
            model=s.image_model,
            prompt=prompt,
            size=size,
            n=n,
            quality=quality,
        )
    except Exception as e:
        # Some OpenAI-compatible image gateways reject the official SDK request
        # headers/body while accepting a plain HTTP POST to /images/generations.
        # Keep this fallback so split image_base_url providers remain usable.
        try:
            return await _generate_image_raw_http(
                settings=s,
                prompt=prompt,
                size=size,
                n=n,
                quality=quality,
            )
        except Exception as raw_e:
            raise RuntimeError(f"图片生成失败: {e}; raw fallback 也失败: {raw_e}") from raw_e

    saved = await _save_image_items(_extract_image_items(resp), s, n)
    if not saved:
        upstream_error = _extract_response_error(resp)
        raise RuntimeError(
            "图片生成失败：上游没有返回可保存的图片数据"
            + (f"；上游错误: {upstream_error}" if upstream_error else "")
            + f"；response_shape={_summarize_response_shape(resp)}"
        )
    return saved


async def _generate_image_raw_http(
    *,
    settings: Settings,
    prompt: str,
    size: str,
    n: int,
    quality: str,
    reference_images: Optional[List[str]] = None,
) -> List[str]:
    """OpenAI-compatible raw image generation fallback.

    This intentionally avoids the SDK because a few proxy gateways are strict
    about SDK-specific headers or request shapes while still supporting the
    standard /images/generations JSON endpoint.
    """
    base_url = settings.effective_image_base_url.rstrip("/")
    url = f"{base_url}/images/generations"
    payload = {
        "model": settings.image_model,
        "prompt": prompt,
        "size": size,
        "n": n,
        "quality": quality,
    }
    if reference_images:
        payload["reference_images"] = reference_images
    headers = {
        "Authorization": f"Bearer {settings.effective_image_api_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=IMAGE_GENERATION_TIMEOUT_SECONDS) as hc:
        r = await hc.post(url, headers=headers, json=payload)
    if r.status_code >= 400:
        detail = r.text[:1000]
        try:
            detail = json.dumps(r.json(), ensure_ascii=False)[:1000]
        except Exception:
            pass
        raise RuntimeError(f"HTTP {r.status_code}: {detail}")
    try:
        data = r.json()
    except Exception as e:
        raise RuntimeError(f"invalid JSON from /images/generations: {r.text[:500]}") from e
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected JSON from /images/generations: {json.dumps(data, ensure_ascii=False)[:500]}")
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"/images/generations error: {json.dumps(data.get('error'), ensure_ascii=False)[:500]}")
    saved = await _save_image_items(_extract_image_items(data), settings, n)
    if not saved:
        raise RuntimeError(f"no image data returned by /images/generations: {_summarize_response_shape(data, limit=500)}")
    return saved


async def _save_image_edit_response(
    data: Any,
    *,
    settings: Settings,
    n: int,
    endpoint: str,
) -> List[str]:
    if isinstance(data, dict) and data.get("error"):
        raise RuntimeError(f"{endpoint} error: {json.dumps(data.get('error'), ensure_ascii=False)[:500]}")
    items = _extract_image_items(data)
    saved = await _save_image_items(items, settings, n)
    if not saved:
        raise RuntimeError(f"no image data returned by {endpoint}: {_summarize_response_shape(data, limit=500)}")
    return saved


def _response_detail(response: httpx.Response, *, limit: int = 1000) -> str:
    try:
        return _summarize_response_shape(response.json(), limit=limit)
    except Exception:
        return response.text[:limit]


def _compact_attempt_errors(errors: List[str], *, limit: int = 2200) -> str:
    out: List[str] = []
    seen = set()
    for err in errors:
        text = str(err or "").strip()
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        out.append(text)
    joined = "；".join(out)
    return joined if len(joined) <= limit else joined[: limit - 1] + "…"


def _is_official_openai_image_base(settings: Settings) -> bool:
    try:
        host = (urlparse(settings.effective_image_base_url).hostname or "").lower()
    except Exception:
        return False
    return host == "api.openai.com" or host.endswith(".api.openai.com")


def _looks_like_timeout_text(value: Any) -> bool:
    text = str(value or "").lower()
    return any(x in text for x in ("timeout", "timed out", "readtimeout"))


def _raw_gateway_rejected_request(errors: List[str]) -> bool:
    """Whether raw edit attempts reached the gateway and were rejected there.

    For non-official gateways, this is a strong signal that the provider's
    /images/edits path is incompatible; skipping the SDK upload avoids another
    long wait for the same upstream failure. Network/DNS failures still allow an
    SDK fallback because those may be test doubles or transient transport issues.
    """
    text = "\n".join(str(e or "") for e in errors).lower()
    return any(x in text for x in ("http 4", "http 5", "/images/edits error", "timeout", "timed out", "readtimeout"))


async def _edit_image_url_raw_http(
    *,
    settings: Settings,
    image_url: str,
    mask_url: Optional[str],
    prompt: str,
    size: str,
    n: int,
    quality: str,
    timeout: float = IMAGE_GENERATION_TIMEOUT_SECONDS,
) -> List[str]:
    """URL/data-URL native image edit fallback for providers that can fetch image_url.

    The official OpenAI SDK edit call uploads image bytes.  Some compatible
    gateways support URL references instead.  Use that shape for public external
    URLs to avoid unnecessary local downloads/copies; the same function also
    supports lossless data URLs as a last-resort fallback for local images.
    """
    base_url = settings.effective_image_base_url.rstrip("/")
    url = f"{base_url}/images/edits"
    headers = {
        "Authorization": f"Bearer {settings.effective_image_api_key}",
        "Content-Type": "application/json",
    }
    base_payload = {
        "model": settings.image_model,
        "prompt": prompt,
        "size": size,
        "n": n,
    }
    base_payload_with_quality = {**base_payload, "quality": quality}
    # Provider variants seen in OpenAI-compatible image gateways.
    attempts: List[Tuple[str, Dict[str, Any]]] = []
    for payload_base in (base_payload_with_quality, base_payload):
        by_url = {**payload_base, "image_url": image_url}
        by_image = {**payload_base, "image": image_url}
        if mask_url:
            by_url["mask_url"] = mask_url
            by_image["mask"] = mask_url
        attempts.extend([("json:image_url", by_url), ("json:image", by_image)])

    errors: List[str] = []
    async with httpx.AsyncClient(timeout=timeout) as hc:
        for label, payload in attempts:
            try:
                r = await hc.post(url, headers=headers, json=payload)
            except Exception as e:
                errors.append(f"{label}: {type(e).__name__}: {e}")
                if _looks_like_timeout_text(f"{type(e).__name__}: {e}"):
                    break
                continue
            if r.status_code >= 400:
                errors.append(f"{label}: HTTP {r.status_code}: {_response_detail(r)}")
                continue
            try:
                data = r.json()
            except Exception as e:
                errors.append(f"{label}: invalid JSON from /images/edits: {r.text[:500]} ({e})")
                continue
            try:
                return await _save_image_edit_response(data, settings=settings, n=n, endpoint="/images/edits")
            except Exception as e:
                errors.append(f"{label}: {e}")
                continue
    raise RuntimeError(_compact_attempt_errors(errors) or "all URL/data-url edit attempts failed")


async def _edit_image_multipart_raw_http(
    *,
    settings: Settings,
    img_path: Path,
    mask_path: Optional[Path],
    prompt: str,
    size: str,
    n: int,
    quality: str,
    timeout: float = IMAGE_GENERATION_TIMEOUT_SECONDS,
) -> List[str]:
    """Plain multipart /images/edits fallback.

    This avoids SDK-specific request wrappers and also retries without `quality`,
    which is important for old OpenAI SDKs and several compatible gateways.
    """
    base_url = settings.effective_image_base_url.rstrip("/")
    url = f"{base_url}/images/edits"
    headers = {"Authorization": f"Bearer {settings.effective_image_api_key}"}
    base_data = {
        "model": settings.image_model,
        "prompt": prompt,
        "size": size,
        "n": str(n),
    }
    attempts: List[Tuple[str, Dict[str, str]]] = [
        ("multipart:with_quality", {**base_data, "quality": quality}),
        ("multipart:no_quality", base_data),
    ]
    img_bytes = img_path.read_bytes()
    mask_bytes = mask_path.read_bytes() if mask_path else None
    errors: List[str] = []
    async with httpx.AsyncClient(timeout=timeout) as hc:
        for label, data in attempts:
            files: Dict[str, Tuple[str, bytes, str]] = {
                "image": (img_path.name, img_bytes, _mime_for_path(img_path)),
            }
            if mask_path and mask_bytes is not None:
                files["mask"] = (mask_path.name, mask_bytes, _mime_for_path(mask_path))
            try:
                r = await hc.post(url, headers=headers, data=data, files=files)
            except Exception as e:
                errors.append(f"{label}: {type(e).__name__}: {e}")
                if _looks_like_timeout_text(f"{type(e).__name__}: {e}"):
                    break
                continue
            if r.status_code >= 400:
                errors.append(f"{label}: HTTP {r.status_code}: {_response_detail(r)}")
                continue
            try:
                payload = r.json()
            except Exception as e:
                errors.append(f"{label}: invalid JSON from /images/edits: {r.text[:500]} ({e})")
                continue
            try:
                return await _save_image_edit_response(payload, settings=settings, n=n, endpoint="/images/edits")
            except Exception as e:
                errors.append(f"{label}: {e}")
                continue
    raise RuntimeError(_compact_attempt_errors(errors) or "all multipart edit attempts failed")



def _is_unexpected_keyword_error(exc: BaseException, keyword: str) -> bool:
    text = f"{type(exc).__name__}: {exc}".lower()
    return "unexpected keyword argument" in text and keyword.lower() in text


async def _sdk_images_edit_with_compat(
    client: AsyncOpenAI,
    *,
    image: Any,
    mask: Optional[Any],
    kwargs: Dict[str, Any],
) -> Any:
    """Call SDK images.edit across openai-python versions.

    Some deployed environments still use openai-python 1.57.x whose
    AsyncImages.edit signature does not accept `quality`, while newer image
    models/gateways often do.  Keep `quality` for providers/SDKs that support it
    and retry once without it when the local SDK rejects the keyword before a
    request is even sent.
    """
    try:
        if mask is not None:
            return await client.images.edit(image=image, mask=mask, **kwargs)
        return await client.images.edit(image=image, **kwargs)
    except TypeError as e:
        if "quality" not in kwargs or not _is_unexpected_keyword_error(e, "quality"):
            raise
        retry_kwargs = dict(kwargs)
        retry_kwargs.pop("quality", None)
        if mask is not None:
            return await client.images.edit(image=image, mask=mask, **retry_kwargs)
        return await client.images.edit(image=image, **retry_kwargs)


async def _save_image_items(items: List[Any], settings: Settings, n: int) -> List[str]:
    Path(settings.image_dir).mkdir(parents=True, exist_ok=True)
    saved: List[str] = []

    # Some OpenAI-compatible gateways may return more items than requested.
    # Honor the caller's n so UI state stays predictable.
    for item in list(items)[:n]:
        if isinstance(item, dict):
            b64 = item.get("b64_json")
            url = item.get("url")
        else:
            b64 = getattr(item, "b64_json", None)
            url = getattr(item, "url", None)

        if b64:
            data, ext = _decode_b64_image_payload(b64)
        elif url:
            data, mime = await _fetch_remote_image_bytes(
                url,
                timeout=IMAGE_GENERATION_TIMEOUT_SECONDS,
                max_bytes=REMOTE_IMAGE_MAX_BYTES,
            )
            ext = _extension_for_mime(mime or "", url)
        else:
            continue

        name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{ext}"
        out_path = Path(settings.image_dir) / name
        out_path.write_bytes(data)
        saved.append(f"/static/images/{name}")
    return saved


def _extract_image_items(value: Any, *, depth: int = 0) -> List[Any]:
    """Extract image result items from common OpenAI-compatible response shapes."""
    if value is None or depth > 5:
        return []
    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump()
        except Exception:
            pass
    if not isinstance(value, (dict, list)) and (getattr(value, "b64_json", None) or getattr(value, "url", None)):
        return [value]
    if not isinstance(value, (dict, list)) and hasattr(value, "data"):
        return _extract_image_items(getattr(value, "data", None), depth=depth + 1)
    if isinstance(value, list):
        out: List[Any] = []
        for item in value:
            out.extend(_extract_image_items(item, depth=depth + 1))
        return out
    if isinstance(value, dict):
        # Standard item shape.
        if value.get("b64_json") or value.get("url"):
            return [value]

        # A few compatible gateways use b64/base64/image_base64 or return a
        # single image string under `image`. Accept these without assuming a
        # particular SDK response class.
        for key in ("b64", "base64", "image_base64"):
            raw = value.get(key)
            if isinstance(raw, str) and raw.strip():
                return [{"b64_json": raw.strip()}]
        raw_image = value.get("image")
        if isinstance(raw_image, str) and raw_image.strip():
            raw = raw_image.strip()
            if raw.startswith("http://") or raw.startswith("https://"):
                return [{"url": raw}]
            if raw.startswith("data:image/") or len(raw) > 100:
                return [{"b64_json": raw}]

        out: List[Any] = []
        # Common non-standard gateway wrappers.
        for key in ("data", "images", "image", "result", "results", "output", "outputs", "items"):
            if key in value:
                out.extend(_extract_image_items(value.get(key), depth=depth + 1))
        return out
    return []


def _summarize_response_shape(value: Any, *, limit: int = 1200) -> str:
    """Return a short, non-secret response-shape summary for diagnostics."""
    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump()
        except Exception:
            value = repr(value)

    def scrub(x: Any, depth: int = 0) -> Any:
        if depth > 4:
            return type(x).__name__
        if isinstance(x, dict):
            out: Dict[str, Any] = {}
            for k, v in x.items():
                if isinstance(v, str) and (len(v) > 120 or k.lower() in {"b64_json", "base64", "image"}):
                    out[k] = f"<str {len(v)} chars>"
                else:
                    out[k] = scrub(v, depth + 1)
            return out
        if isinstance(x, list):
            return [scrub(v, depth + 1) for v in x[:3]] + ([f"... +{len(x) - 3}"] if len(x) > 3 else [])
        if isinstance(x, str):
            return x[:180]
        return x

    try:
        text = json.dumps(scrub(value), ensure_ascii=False)
    except Exception:
        text = repr(value)
    return text[:limit]


def _extract_response_error(value: Any) -> str:
    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump()
        except Exception:
            return ""
    if not isinstance(value, dict):
        return ""
    err = value.get("error")
    if not err:
        return ""
    try:
        return json.dumps(err, ensure_ascii=False)[:800]
    except Exception:
        return str(err)[:800]


def _resolve_local_path(url_or_path: str) -> Path:
    """Translate /static/images/foo.png (or absolute path) back to the on-disk file."""
    s = get_settings()
    base = Path(s.image_dir).resolve()
    static_path = _local_static_path_part(url_or_path, s)
    if static_path:
        url_or_path = static_path
    if url_or_path.startswith("/static/images/"):
        rel = url_or_path[len("/static/images/"):].lstrip("/")
        candidate = (base / rel).resolve()
    p = Path(url_or_path)
    if not url_or_path.startswith("/static/images/") and p.is_absolute():
        candidate = p.resolve()
    elif not url_or_path.startswith("/static/images/"):
        candidate = (base / p.name).resolve()
    if not candidate.is_relative_to(base):
        raise ValueError(f"image path outside image_dir is not allowed: {url_or_path}")
    return candidate


async def edit_image(
    image_url: str,
    mask_url: Optional[str],
    prompt: str,
    size: str = "1024x1024",
    n: int = 1,
    quality: str = "high",
    settings: Optional[Settings] = None,
) -> List[str]:
    """Image-to-image edit via OpenAI `images.edit`.

    - image_url:  /static/images/xxx.png that backend has on disk
    - mask_url:   optional mask where transparent pixels mark the region to edit
                  (None means full-image edit / variation)
    - prompt:     what to paint in the masked region (for inpaint) or how to edit overall
    """
    s = _effective_settings(settings)
    size = _normalize_image_size(size)
    n = _normalize_image_count(n)
    quality = _normalize_image_quality(quality, s.image_model)
    Path(s.image_dir).mkdir(parents=True, exist_ok=True)
    attempt_errors: List[str] = []

    provider_image_url = _provider_image_url(image_url, s)
    provider_mask_url = _provider_image_url(mask_url, s) if mask_url else None
    external_image_url = _is_public_remote_url(image_url) and not _is_app_static_image_reference(image_url, s)
    external_mask_url = bool(mask_url) and _is_public_remote_url(mask_url) and not _is_app_static_image_reference(mask_url, s)
    if provider_image_url and (not mask_url or provider_mask_url):
        try:
            return await _edit_image_url_raw_http(
                settings=s,
                image_url=provider_image_url,
                mask_url=provider_mask_url,
                prompt=prompt,
                size=size,
                n=n,
                quality=quality,
            )
        except Exception as e:
            # Public external URLs should remain URL-only; local static images
            # can safely fall back to SDK upload if the provider rejects URL
            # edits.
            if external_image_url or external_mask_url:
                raise RuntimeError(f"图片编辑失败：上游未接受外部图片 URL: {e}") from e
            attempt_errors.append(f"URL-native edit: {type(e).__name__}: {e}")
    if external_image_url or external_mask_url:
        raise RuntimeError(
            "图片编辑失败：公开外部 URL 默认不下载到本地；当前图片/mask 混合了外部 URL 与本地文件，"
            "上游接口无法一次性读取。请使用全部外部可访问 URL，或先上传/保存为本地图后再编辑。"
        )

    client = get_client(s, kind="image")
    img_path = await _ensure_local_image_path(image_url, s, suffix="ref")
    if not img_path.exists():
        raise FileNotFoundError(f"image not found: {image_url}")

    kwargs: Dict[str, Any] = {
        "model": s.image_model,
        "prompt": prompt,
        "size": size,
        "n": n,
        "quality": quality,
    }

    img_bytes = img_path.read_bytes()
    files_image = (img_path.name, img_bytes, _mime_for_path(img_path))

    mask_path: Optional[Path] = None
    mask_bytes: Optional[bytes] = None
    if mask_url:
        mask_path = await _ensure_local_image_path(mask_url, s, suffix="mask")
        if not mask_path.exists():
            raise FileNotFoundError(f"mask not found: {mask_url}")
        mask_bytes = mask_path.read_bytes()


    async def _attempt_sdk_upload() -> Optional[List[str]]:
        try:
            if mask_bytes is not None and mask_path is not None:
                resp = await _sdk_images_edit_with_compat(
                    client,
                    image=files_image,
                    mask=(mask_path.name, mask_bytes, _mime_for_path(mask_path)),
                    kwargs=kwargs,
                )
            else:
                resp = await _sdk_images_edit_with_compat(
                    client,
                    image=files_image,
                    mask=None,
                    kwargs=kwargs,
                )
            response_items = _extract_image_items(resp)
            saved = await _save_image_items(response_items, s, n)
            if saved:
                return saved
            upstream_error = _extract_response_error(resp)
            attempt_errors.append(
                "SDK upload: 上游没有返回可保存的图片数据"
                + (f"，上游错误: {upstream_error}" if upstream_error else "")
                + f"，response_shape={_summarize_response_shape(resp, limit=500)}"
            )
        except Exception as e:
            attempt_errors.append(f"SDK upload: {type(e).__name__}: {e}")
        return None

    async def _attempt_raw_multipart() -> Optional[List[str]]:
        try:
            return await _edit_image_multipart_raw_http(
                settings=s,
                img_path=img_path,
                mask_path=mask_path,
                prompt=prompt,
                size=size,
                n=n,
                quality=quality,
                timeout=IMAGE_EDIT_COMPAT_TIMEOUT_SECONDS,
            )
        except Exception as e:
            attempt_errors.append(f"raw multipart: {type(e).__name__}: {e}")
        return None

    async def _attempt_data_url_json() -> Optional[List[str]]:
        try:
            data_image_url = _original_image_data_url(img_bytes, source_name=img_path.name, mime=_mime_for_path(img_path))
            data_mask_url = (
                _original_image_data_url(mask_bytes, source_name=mask_path.name, mime=_mime_for_path(mask_path))
                if mask_bytes is not None and mask_path is not None
                else None
            )
            return await _edit_image_url_raw_http(
                settings=s,
                image_url=data_image_url,
                mask_url=data_mask_url,
                prompt=prompt,
                size=size,
                n=n,
                quality=quality,
                timeout=IMAGE_EDIT_COMPAT_TIMEOUT_SECONDS,
            )
        except Exception as e:
            attempt_errors.append(f"raw data-url: {type(e).__name__}: {e}")
        return None

    sdk_first = _is_official_openai_image_base(s)
    if sdk_first:
        for attempt in (_attempt_sdk_upload, _attempt_raw_multipart, _attempt_data_url_json):
            saved = await attempt()
            if saved:
                return saved
    else:
        raw_error_start = len(attempt_errors)
        saved = await _attempt_raw_multipart()
        if saved:
            return saved

        # If a custom gateway has already rejected raw multipart with an HTTP/upstream
        # error, do not send the same local file as a giant data URL or SDK upload.
        # In practice this avoids 1-3 minute hangs ending in 524/empty upstream output.
        raw_errors = attempt_errors[raw_error_start:]
        if _raw_gateway_rejected_request(raw_errors):
            attempt_errors.append(
                "raw data-url / SDK upload: 已跳过。当前为非官方 image_base_url，raw multipart 已返回 HTTP/超时/上游错误；"
                "继续尝试其它上传形态通常只会等待更久并得到同一上游失败。"
            )
        else:
            data_url_error_start = len(attempt_errors)
            saved = await _attempt_data_url_json()
            if saved:
                return saved
            raw_errors = attempt_errors[raw_error_start:]
            if not _raw_gateway_rejected_request(raw_errors[data_url_error_start - raw_error_start:]):
                saved = await _attempt_sdk_upload()
                if saved:
                    return saved
            else:
                attempt_errors.append(
                    "SDK upload: 已跳过。当前为非官方 image_base_url，raw data-url 已返回 HTTP/超时/上游错误；"
                    "继续走 SDK 通常只会等待更久并得到同一上游失败。"
                )

    hint = ""
    if not _configured_public_base_url(s):
        hint = (
            " 当前未配置 public_base_url，本地 /static/images 无法让上游直接抓取；"
            "如果当前网关不兼容文件上传/data-url 式 images.edit，请在设置页配置可公网访问的域名，"
            "并先运行“静态图片公网可访问测试”。"
        )
    raise RuntimeError(
        "图片编辑失败：所有兼容调用方式均失败。"
        + hint
        + " 失败详情: "
        + _compact_attempt_errors(attempt_errors)
    )


def save_png_bytes(data: bytes, suffix: str = "") -> str:
    """Persist arbitrary PNG bytes (for uploads/masks/crops). Returns public URL."""
    s = get_settings()
    Path(s.image_dir).mkdir(parents=True, exist_ok=True)
    sfx = f"_{suffix}" if suffix else ""
    name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}{sfx}.png"
    (Path(s.image_dir) / name).write_bytes(data)
    return f"/static/images/{name}"


def crop_image(
    image_url: str,
    x: int,
    y: int,
    w: int,
    h: int,
) -> str:
    """Crop an existing image by pixel box. Returns public URL of the new file."""
    from PIL import Image

    src = _resolve_local_path(image_url)
    if not src.exists():
        raise FileNotFoundError(f"image not found: {image_url}")
    with Image.open(src) as im:
        im = im.convert("RGBA")
        x = max(0, min(im.width - 1, x))
        y = max(0, min(im.height - 1, y))
        x2 = max(x + 1, min(im.width, x + w))
        y2 = max(y + 1, min(im.height, y + h))
        cropped = im.crop((x, y, x2, y2))
        buf = io.BytesIO()
        cropped.save(buf, format="PNG")
        return save_png_bytes(buf.getvalue(), suffix="crop")
