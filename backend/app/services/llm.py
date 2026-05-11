from __future__ import annotations

import base64
import io
import time
import uuid
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx
from openai import AsyncOpenAI

from ..config import get_settings


_client: Optional[AsyncOpenAI] = None
_client_key: Optional[tuple] = None


def reset_client() -> None:
    global _client, _client_key
    _client = None
    _client_key = None


def get_client() -> AsyncOpenAI:
    global _client, _client_key
    s = get_settings()
    key = (s.openai_api_key, s.openai_base_url)
    if _client is None or _client_key != key:
        _client = AsyncOpenAI(
            api_key=s.openai_api_key,
            base_url=s.openai_base_url,
            timeout=180.0,
        )
        _client_key = key
    return _client


def to_openai_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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
            for url in images:
                parts.append({"type": "image_url", "image_url": {"url": url}})
            out.append({"role": role, "content": parts})
        else:
            out.append({"role": role, "content": content})
    return out


async def chat_completion(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: str = "auto",
    temperature: float = 0.7,
    model: Optional[str] = None,
) -> Any:
    client = get_client()
    s = get_settings()
    kwargs: Dict[str, Any] = {
        "model": model or s.chat_model,
        "messages": to_openai_messages(messages),
        "temperature": temperature,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice
    return await client.chat.completions.create(**kwargs)


async def chat_completion_stream(
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    temperature: float = 0.7,
    model: Optional[str] = None,
) -> AsyncIterator[Any]:
    client = get_client()
    s = get_settings()
    kwargs: Dict[str, Any] = {
        "model": model or s.chat_model,
        "messages": to_openai_messages(messages),
        "temperature": temperature,
        "stream": True,
    }
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        yield chunk


async def generate_image(
    prompt: str,
    size: str = "1024x1536",
    n: int = 1,
    reference_images: Optional[List[str]] = None,
) -> List[str]:
    client = get_client()
    s = get_settings()
    Path(s.image_dir).mkdir(parents=True, exist_ok=True)
    saved: List[str] = []

    try:
        resp = await client.images.generate(
            model=s.image_model,
            prompt=prompt,
            size=size,
            n=n,
        )
    except Exception as e:
        raise RuntimeError(f"图片生成失败: {e}") from e

    for item in resp.data:
        b64 = getattr(item, "b64_json", None)
        if b64:
            data = base64.b64decode(b64)
        else:
            url = getattr(item, "url", None)
            if not url:
                continue
            async with httpx.AsyncClient(timeout=120) as hc:
                r = await hc.get(url)
                r.raise_for_status()
                data = r.content
        name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}.png"
        out_path = Path(s.image_dir) / name
        out_path.write_bytes(data)
        saved.append(f"/static/images/{name}")
    return saved


def _resolve_local_path(url_or_path: str) -> Path:
    """Translate /static/images/foo.png (or absolute path) back to the on-disk file."""
    s = get_settings()
    if url_or_path.startswith("/static/images/"):
        name = url_or_path.rsplit("/", 1)[-1]
        return Path(s.image_dir) / name
    p = Path(url_or_path)
    if p.is_absolute():
        return p
    return Path(s.image_dir) / p.name


async def edit_image(
    image_url: str,
    mask_url: Optional[str],
    prompt: str,
    size: str = "1024x1024",
    n: int = 1,
) -> List[str]:
    """Image-to-image edit via OpenAI `images.edit`.

    - image_url:  /static/images/xxx.png that backend has on disk
    - mask_url:   optional mask where transparent pixels mark the region to edit
                  (None means full-image edit / variation)
    - prompt:     what to paint in the masked region (for inpaint) or how to edit overall
    """
    client = get_client()
    s = get_settings()
    Path(s.image_dir).mkdir(parents=True, exist_ok=True)

    img_path = _resolve_local_path(image_url)
    if not img_path.exists():
        raise FileNotFoundError(f"image not found: {image_url}")

    kwargs: Dict[str, Any] = {
        "model": s.image_model,
        "prompt": prompt,
        "size": size,
        "n": n,
    }

    img_bytes = img_path.read_bytes()
    files_image = (img_path.name, img_bytes, "image/png")

    mask_bytes: Optional[bytes] = None
    if mask_url:
        mask_path = _resolve_local_path(mask_url)
        if not mask_path.exists():
            raise FileNotFoundError(f"mask not found: {mask_url}")
        mask_bytes = mask_path.read_bytes()

    try:
        if mask_bytes is not None:
            resp = await client.images.edit(
                image=files_image,
                mask=(Path(mask_url).name, mask_bytes, "image/png"),
                **kwargs,
            )
        else:
            resp = await client.images.edit(
                image=files_image,
                **kwargs,
            )
    except Exception as e:
        raise RuntimeError(f"图片编辑失败: {e}") from e

    saved: List[str] = []
    for item in resp.data:
        b64 = getattr(item, "b64_json", None)
        if b64:
            data = base64.b64decode(b64)
        else:
            url = getattr(item, "url", None)
            if not url:
                continue
            async with httpx.AsyncClient(timeout=120) as hc:
                r = await hc.get(url)
                r.raise_for_status()
                data = r.content
        name = f"{int(time.time()*1000)}_{uuid.uuid4().hex[:8]}.png"
        (Path(s.image_dir) / name).write_bytes(data)
        saved.append(f"/static/images/{name}")
    return saved


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
        x2 = max(x + 1, min(im.width, x + w))
        y2 = max(y + 1, min(im.height, y + h))
        x = max(0, min(im.width - 1, x))
        y = max(0, min(im.height - 1, y))
        cropped = im.crop((x, y, x2, y2))
        buf = io.BytesIO()
        cropped.save(buf, format="PNG")
        return save_png_bytes(buf.getvalue(), suffix="crop")
