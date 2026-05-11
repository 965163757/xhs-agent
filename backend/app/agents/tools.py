"""Agent tool definitions. Each tool is both an OpenAI function-calling schema
and an MCP-compatible callable. The backend API and the embedded MCP endpoints
share this registry."""
from __future__ import annotations

import json
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

from sqlalchemy import select

from ..database import Article, Conversation, SessionLocal, Template
from ..services.llm import chat_completion, crop_image, edit_image, generate_image


ToolFn = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]


# ---------- helpers ----------

async def _get_article(article_id: int) -> Optional[Article]:
    async with SessionLocal() as s:
        return await s.get(Article, article_id)


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


XHS_WRITER_SYSTEM = (
    "你是小红书内容创作专家，熟悉平台话术、emoji 使用、分段、标签与钩子写法。"
    "输出必须满足：1) 吸引人的标题（≤20字，带关键词/数字/情绪词，1-2 个 emoji）；"
    "2) 首句强钩子；3) 内容分段清晰，善用短句、表情、符号分隔；"
    "4) 结尾引导互动；5) 附 5-10 个精准标签（带 # 前缀）。"
    '严格按 JSON 返回：{"title":"...","body":"...","tags":["#tag1","#tag2"]}'
)


# ---------- CRUD tools ----------

async def tool_create_article(args: Dict[str, Any]) -> Dict[str, Any]:
    title = args.get("title", "")
    body = args.get("body", "")
    tags = args.get("tags", []) or []
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft")
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_update_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        for key in ("title", "body", "cover_image", "status"):
            if key in args and args[key] is not None:
                setattr(art, key, args[key])
        if "tags" in args and args["tags"] is not None:
            art.tags = ",".join(args["tags"])
        if "images" in args and args["images"] is not None:
            art.images = args["images"]
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_read_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    return {"ok": True, "article": art.to_dict()}


async def tool_list_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    limit = int(args.get("limit", 20))
    async with SessionLocal() as s:
        res = await s.execute(
            select(Article).order_by(Article.updated_at.desc()).limit(limit)
        )
        items = [a.to_dict() for a in res.scalars().all()]
        return {"ok": True, "items": items}


async def tool_delete_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
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
    extra = args.get("extra", "")

    user_prompt = (
        f"主题：{topic}\n语气：{tone}\n长度：{length}\n目标受众：{audience}\n补充：{extra}\n"
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
    title = data.get("title") or topic
    body = data.get("body") or content
    tags = data.get("tags") or []

    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft")
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_rewrite_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    style = args.get("style", "更有网感、更口语化")
    instruction = args.get("instruction", "")

    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}

    resp = await chat_completion(
        messages=[
            {"role": "system", "content": XHS_WRITER_SYSTEM},
            {
                "role": "user",
                "content": (
                    f"请基于下列原稿改写为小红书风格。\n改写风格：{style}\n附加要求：{instruction}\n"
                    f"原标题：{art.title}\n原正文：\n{art.body}\n"
                    "严格按系统要求 JSON 返回。"
                ),
            },
        ],
        temperature=0.85,
    )
    content = resp.choices[0].message.content or ""
    data = _safe_json(content)

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.title = data.get("title") or art.title
        art.body = data.get("body") or art.body
        if data.get("tags"):
            art.tags = ",".join(data["tags"])
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_optimize_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    focus = args.get("focus", "标题吸引力、开头钩子、情绪价值、标签")
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}

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
                    f"优化重点：{focus}\n原标题：{art.title}\n原正文：\n{art.body}\n原标签：{art.tags}"
                ),
            },
        ],
        temperature=0.7,
    )
    content = resp.choices[0].message.content or ""
    data = _safe_json(content)

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.title = data.get("title") or art.title
        art.body = data.get("body") or art.body
        if data.get("tags"):
            art.tags = ",".join(data["tags"])
        await s.commit()
        await s.refresh(art)
        result = art.to_dict()
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
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书数据专家，从五个维度打分（0-100）："
                    "内容质量 content、视觉吸引 visual、增长潜力 growth、互动潜力 engagement、综合 overall。"
                    "严格按 JSON 返回："
                    '{"content":90,"visual":80,"growth":75,"engagement":82,"overall":82,"advice":["..."]}'
                ),
            },
            {"role": "user", "content": f"标题：{art.title}\n正文：\n{art.body}\n标签：{art.tags}"},
        ],
        temperature=0.3,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        art.score = data
        await s.commit()
        await s.refresh(art)
    return {"ok": True, "score": data, "article_id": aid}


async def tool_diagnose_article(args: Dict[str, Any]) -> Dict[str, Any]:
    """Publish-readiness diagnostic: risk points, missing elements, fix suggestions."""
    aid = int(args["article_id"])
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书审稿专家，发稿前做诊断。列出："
                    "风险（平台违禁词、敏感表达、广告法禁用词）、"
                    "缺失（钩子/标签/CTA/分段）、"
                    "可改进建议（3-5 条，可执行）。"
                    '严格 JSON：{"risks":["..."],"missing":["..."],"suggestions":["..."],"publish_ready":true|false}'
                ),
            },
            {
                "role": "user",
                "content": f"标题：{art.title}\n正文：\n{art.body}\n标签：{art.tags}",
            },
        ],
        temperature=0.2,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "article_id": aid, "diagnostic": data}


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
    n = int(args.get("n", 6))
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
            {"role": "user", "content": f"主题：{topic}\n素材：{body}"},
        ],
        temperature=0.95,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "titles": data.get("titles", [])[:n]}


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
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    "你是小红书封面美学顾问。输出一条适合 gpt-image-2 的英文 prompt，"
                    "描述主体/构图/光影/色彩/文字效果（若需要），以及竖图 2:3。"
                    '严格 JSON：{"prompt":"...","size":"1024x1536"}'
                ),
            },
            {"role": "user", "content": f"标题：{title}\n主题：{topic}\n风格：{style}"},
        ],
        temperature=0.8,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    return {"ok": True, "cover": data}


# ---------- images ----------

async def tool_generate_image(args: Dict[str, Any]) -> Dict[str, Any]:
    prompt = args["prompt"]
    size = args.get("size", "1024x1536")
    n = int(args.get("n", 1))
    urls = await generate_image(prompt=prompt, size=size, n=n)
    aid = args.get("article_id")
    role = args.get("role", "content")
    replace_index = args.get("replace_index")
    if aid:
        async with SessionLocal() as s:
            art = await s.get(Article, int(aid))
            if art:
                if role == "cover":
                    art.cover_image = urls[0] if urls else art.cover_image
                elif replace_index is not None and urls:
                    imgs = list(art.images or [])
                    idx = int(replace_index)
                    if 0 <= idx < len(imgs):
                        imgs[idx] = urls[0]
                    else:
                        imgs.extend(urls)
                    art.images = imgs
                else:
                    art.images = (art.images or []) + urls
                await s.commit()
                await s.refresh(art)
    return {"ok": True, "images": urls}


async def tool_remove_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Remove an image from an article (cover or a specific content image)."""
    aid = int(args["article_id"])
    role = args.get("role", "content")
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        if role == "cover":
            art.cover_image = ""
        else:
            idx = args.get("index")
            imgs = list(art.images or [])
            if idx is None:
                imgs = []
            else:
                idx = int(idx)
                if 0 <= idx < len(imgs):
                    imgs.pop(idx)
            art.images = imgs
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_content_image_prompt(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = args.get("article_id")
    topic = args.get("topic", "")
    title = args.get("title", "")
    body = args.get("body", "")
    n = int(args.get("n", 4))
    if aid and not body:
        art = await _get_article(int(aid))
        if art:
            title = title or art.title
            body = art.body
            topic = topic or art.title
    resp = await chat_completion(
        messages=[
            {
                "role": "system",
                "content": (
                    f"你是小红书配图导演。根据笔记内容产出 {n} 条不同场景的正文配图 prompt，"
                    "每条对应正文的一个段落/要点，适合 gpt-image-2 使用。"
                    "英文 prompt 效果最佳，但如果主题是中文环境可中英混合。"
                    '严格按 JSON 返回：'
                    '{"shots":[{"scene":"中文场景标题","prompt":"英文描述","size":"1024x1024"}]}'
                ),
            },
            {
                "role": "user",
                "content": f"主题：{topic}\n标题：{title}\n正文：\n{body}",
            },
        ],
        temperature=0.8,
    )
    data = _safe_json(resp.choices[0].message.content or "")
    shots = data.get("shots", [])[:n]
    return {"ok": True, "shots": shots}


# ---------- image editing (crop / inpaint / remove) ----------

async def _bind_image_to_article(
    url: str,
    article_id: Optional[int],
    role: str = "content",
    replace_index: Optional[int] = None,
) -> None:
    if not article_id:
        return
    async with SessionLocal() as s:
        art = await s.get(Article, int(article_id))
        if not art:
            return
        if role == "cover":
            art.cover_image = url
        else:
            imgs = list(art.images or [])
            if replace_index is not None:
                idx = int(replace_index)
                if 0 <= idx < len(imgs):
                    imgs[idx] = url
                else:
                    imgs.append(url)
            else:
                imgs.append(url)
            art.images = imgs
        await s.commit()


async def tool_crop_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Crop an image by pixel box. Result can replace cover / content slot."""
    image_url = args["image_url"]
    x = int(args.get("x", 0))
    y = int(args.get("y", 0))
    w = int(args.get("w", 0))
    h = int(args.get("h", 0))
    if w <= 0 or h <= 0:
        return {"ok": False, "error": "w/h must be > 0"}
    new_url = crop_image(image_url, x, y, w, h)
    await _bind_image_to_article(
        new_url,
        args.get("article_id"),
        args.get("role", "content"),
        args.get("replace_index"),
    )
    return {"ok": True, "image": new_url}


async def tool_inpaint_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Inpaint the transparent region of mask with new content described by prompt."""
    image_url = args["image_url"]
    mask_url = args.get("mask_url")
    prompt = args.get("prompt") or "match surrounding style"
    size = args.get("size", "1024x1024")
    urls = await edit_image(image_url, mask_url, prompt, size=size, n=1)
    if not urls:
        return {"ok": False, "error": "no image returned"}
    await _bind_image_to_article(
        urls[0],
        args.get("article_id"),
        args.get("role", "content"),
        args.get("replace_index"),
    )
    return {"ok": True, "image": urls[0]}


async def tool_remove_object(args: Dict[str, Any]) -> Dict[str, Any]:
    """Erase / clean the masked region by inpainting with a 'clean background' prompt."""
    image_url = args["image_url"]
    mask_url = args["mask_url"]
    prompt = args.get("prompt") or (
        "seamlessly fill and clean this region, continue the surrounding background, "
        "remove any object present in the masked area, keep the same lighting, texture and color"
    )
    size = args.get("size", "1024x1024")
    urls = await edit_image(image_url, mask_url, prompt, size=size, n=1)
    if not urls:
        return {"ok": False, "error": "no image returned"}
    await _bind_image_to_article(
        urls[0],
        args.get("article_id"),
        args.get("role", "content"),
        args.get("replace_index"),
    )
    return {"ok": True, "image": urls[0]}


async def tool_edit_image(args: Dict[str, Any]) -> Dict[str, Any]:
    """Generic image-to-image edit without mask (variation / style shift)."""
    image_url = args["image_url"]
    prompt = args.get("prompt") or "enhance clarity, keep composition"
    size = args.get("size", "1024x1024")
    urls = await edit_image(image_url, None, prompt, size=size, n=1)
    if not urls:
        return {"ok": False, "error": "no image returned"}
    await _bind_image_to_article(
        urls[0],
        args.get("article_id"),
        args.get("role", "content"),
        args.get("replace_index"),
    )
    return {"ok": True, "image": urls[0]}


# ---------- templates ----------

async def tool_list_templates(args: Dict[str, Any]) -> Dict[str, Any]:
    async with SessionLocal() as s:
        res = await s.execute(select(Template).order_by(Template.id.asc()))
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
    title = data.get("title") or topic
    body = data.get("body") or ""
    tags = data.get("tags") or []
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft")
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


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
                "extra": {"type": "string"},
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
                "style": {"type": "string"},
                "instruction": {"type": "string"},
            },
            required=["article_id"],
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
            "对笔记进行五维度打分并写回。",
            {"article_id": {"type": "integer"}},
            required=["article_id"],
        ),
    },
    "diagnose_article": {
        "fn": tool_diagnose_article,
        "schema": _fn_schema(
            "diagnose_article",
            "发布前诊断：违禁词、钩子缺失、CTA、可改进建议。",
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
            "读取指定笔记详情。",
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
            "用 gpt-image-2 生成图片，可直接绑定到笔记（role=cover|content）。若指定 replace_index，则替换该位置的配图。",
            {
                "prompt": {"type": "string"},
                "size": {"type": "string", "description": "如 1024x1536 / 1024x1024"},
                "n": {"type": "integer"},
                "article_id": {"type": "integer"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "replace_index": {"type": "integer", "description": "替换第 N 张内容配图（0-based）"},
            },
            required=["prompt"],
        ),
    },
    "remove_image": {
        "fn": tool_remove_image,
        "schema": _fn_schema(
            "remove_image",
            "删除笔记的封面或某张内容配图。",
            {
                "article_id": {"type": "integer"},
                "role": {"type": "string", "enum": ["cover", "content"]},
                "index": {"type": "integer", "description": "role=content 时的 0-based 下标，省略表示清空全部"},
            },
            required=["article_id"],
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
            "局部重绘：在 mask 透明区域按 prompt 生成新内容。mask 是与原图等尺寸的 PNG，透明像素即可编辑区域。",
            {
                "image_url": {"type": "string"},
                "mask_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "article_id": {"type": "integer"},
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
            "消除：在 mask 透明区域自动填充和周围环境一致的内容，用来擦除物体/水印/路人。",
            {
                "image_url": {"type": "string"},
                "mask_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "article_id": {"type": "integer"},
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
            "整图风格化编辑（不带 mask）。",
            {
                "image_url": {"type": "string"},
                "prompt": {"type": "string"},
                "size": {"type": "string"},
                "article_id": {"type": "integer"},
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
            "根据主题/标题产出封面图的 gpt-image-2 prompt。",
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
}


def openai_tool_schemas() -> List[Dict[str, Any]]:
    return [t["schema"] for t in TOOLS.values()]


async def call_tool(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    if name not in TOOLS:
        return {"ok": False, "error": f"unknown tool: {name}"}
    fn: ToolFn = TOOLS[name]["fn"]
    return await fn(args or {})
