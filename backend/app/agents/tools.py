"""Agent tool definitions. Each tool is both an OpenAI function-calling schema
and an MCP-compatible callable. The backend API and the embedded MCP endpoints
share this registry."""
from __future__ import annotations

import contextvars
import json
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional

from sqlalchemy import select

from ..database import Article, ArticleVersion, Conversation, SessionLocal, Template
from ..services.llm import chat_completion, crop_image, edit_image, generate_image


ToolFn = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]

_current_user_id: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar(
    "_current_user_id", default=None
)


def get_tool_user_id() -> Optional[int]:
    return _current_user_id.get()


def set_tool_user_id(uid: Optional[int]) -> contextvars.Token:
    return _current_user_id.set(uid)


# ---------- helpers ----------

async def _get_article(article_id: int) -> Optional[Article]:
    async with SessionLocal() as s:
        return await s.get(Article, article_id)


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


XHS_WRITER_SYSTEM = (
    "你是小红书爆款内容创作专家，精通平台话术、用户心理和流量机制。"
    "你的文风像跟闺蜜聊天——真诚、有温度、口语化，但信息密度高。\n\n"
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


# ---------- CRUD tools ----------

async def tool_create_article(args: Dict[str, Any]) -> Dict[str, Any]:
    title = args.get("title", "")
    body = args.get("body", "")
    tags = args.get("tags", []) or []
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_update_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        if uid and art.user_id != uid:
            return {"ok": False, "error": "无权操作该笔记"}
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
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid and art.user_id != uid:
        return {"ok": False, "error": "无权访问该笔记"}
    return {"ok": True, "article": art.to_dict()}


async def tool_list_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    limit = int(args.get("limit", 20))
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        q = select(Article).order_by(Article.updated_at.desc()).limit(limit)
        if uid:
            q = q.where(Article.user_id == uid)
        res = await s.execute(q)
        items = [a.to_dict() for a in res.scalars().all()]
        return {"ok": True, "items": items}


async def tool_delete_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        if uid and art.user_id != uid:
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

    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


async def tool_rewrite_article(args: Dict[str, Any]) -> Dict[str, Any]:
    aid = int(args["article_id"])
    style = args.get("style", "更有网感、更口语化")
    instruction = args.get("instruction", "")
    uid = get_tool_user_id()

    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}

    await _snapshot_article(aid, "rewrite")

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
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}

    await _snapshot_article(aid, "optimize")

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
    uid = get_tool_user_id()
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}
    if uid and art.user_id != uid:
        return {"ok": False, "error": "无权操作该笔记"}
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
    """Multi-agent diagnosis: 4 experts + debate + judge."""
    from .diagnosis import run_diagnosis
    from .research_data import detect_category
    from .text_analyzer import full_analysis

    aid = int(args["article_id"])
    art = await _get_article(aid)
    if not art:
        return {"ok": False, "error": f"article {aid} not found"}

    tags = [t for t in (art.tags or "").split(",") if t.strip()]
    images = art.images or []
    image_count = len(images) + (1 if art.cover_image else 0)

    result = await run_diagnosis(
        title=art.title or "",
        content=art.body or "",
        tags=tags,
        image_count=image_count,
        images=images,
    )

    return {
        "ok": True,
        "article_id": aid,
        "overall_score": result.overall_score,
        "grade": result.grade,
        "radar_data": result.radar_data,
        "issues": result.issues,
        "suggestions": result.suggestions,
        "optimized_title": result.optimized_title,
        "optimized_content": result.optimized_content,
        "optimized_tags": result.optimized_tags,
        "simulated_comments": result.simulated_comments,
        "debate_summary": result.debate_summary,
        "category": result.category_cn,
        "elapsed_ms": result.elapsed_ms,
    }


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
                    "竖图比例 2:3。\n"
                    '严格 JSON：{"prompt":"中文描述...","size":"1024x1536"}'
                ),
            },
            {"role": "user", "content": f"标题：{title}\n主题：{topic}\n风格偏好：{style}"},
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
                    f"你是小红书内容配图导演，擅长将文字转化为有氛围感的视觉画面。\n\n"
                    f"根据笔记内容，产出 {n} 条配图 prompt（中文），每条对应正文的一个段落或核心信息点。\n\n"
                    "【配图原则】\n"
                    "- 视觉一致性：所有配图保持统一的色调、风格和滤镜感\n"
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
                    "正方形比例 1:1。prompt 用中文。\n"
                    '严格按 JSON 返回：'
                    '{"shots":[{"scene":"场景标题","prompt":"中文描述","size":"1024x1024"}]}'
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
    uid = get_tool_user_id()
    async with SessionLocal() as s:
        art = Article(title=title, body=body, tags=",".join(tags), status="draft", user_id=uid)
        s.add(art)
        await s.commit()
        await s.refresh(art)
        return {"ok": True, "article": art.to_dict()}


# ---------- search / batch / export / stats / schedule ----------

async def tool_search_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    """Full-text search articles by keyword, with optional status/tag filters."""
    keyword = args.get("keyword", "")
    status_filter = args.get("status")
    tag_filter = args.get("tag")
    limit = int(args.get("limit", 20))
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
        results.append(a.to_dict())
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
        results.append({"article_id": int(aid), "score": r.get("score", {})})

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
        results.append({"article_id": int(aid), "ok": r.get("ok", False)})

    return {"ok": True, "results": results}


async def tool_export_articles(args: Dict[str, Any]) -> Dict[str, Any]:
    """Export articles as JSON array with optional filters."""
    status_filter = args.get("status")
    tag_filter = args.get("tag")
    limit = int(args.get("limit", 50))
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
        items = [a.to_dict() for a in res.scalars().all()]

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
    from datetime import datetime as dt

    aid = int(args["article_id"])
    scheduled_at_str = args.get("scheduled_at", "")

    async with SessionLocal() as s:
        art = await s.get(Article, aid)
        if not art:
            return {"ok": False, "error": f"article {aid} not found"}
        art.status = "scheduled"
        if scheduled_at_str:
            try:
                art.scheduled_at = dt.fromisoformat(scheduled_at_str)
            except ValueError:
                return {"ok": False, "error": f"invalid datetime: {scheduled_at_str}"}
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
