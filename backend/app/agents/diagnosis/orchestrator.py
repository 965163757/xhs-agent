"""
诊断编排器：协调 4 个专家 Agent 并行评估 → 辩论 → 裁判汇总。
支持 SSE 流式进度回调。
"""
from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Coroutine, Dict, List, Optional

from ...services.llm import chat_completion
from ...config import Settings
from ..research_data import build_data_prompt, detect_category, pre_score, CATEGORY_CN
from ..text_analyzer import full_analysis
from .prompts import (
    CONTENT_AGENT_PROMPT,
    DEBATE_PROMPT,
    GROWTH_AGENT_PROMPT,
    JUDGE_AGENT_PROMPT,
    USER_SIM_AGENT_PROMPT,
    VISUAL_AGENT_PROMPT,
)


@dataclass
class DiagnosisResult:
    overall_score: int = 0
    grade: str = "C"
    radar_data: Dict[str, float] = field(default_factory=dict)
    issues: List[Dict[str, Any]] = field(default_factory=list)
    suggestions: List[Dict[str, Any]] = field(default_factory=list)
    debate_summary: str = ""
    optimized_title: str = ""
    optimized_content: str = ""
    optimized_tags: List[str] = field(default_factory=list)
    cover_direction: Dict[str, Any] = field(default_factory=dict)
    simulated_comments: List[Dict[str, Any]] = field(default_factory=list)
    agent_opinions: List[Dict[str, Any]] = field(default_factory=list)
    debate_results: List[Dict[str, Any]] = field(default_factory=list)
    model_a_score: Dict[str, Any] = field(default_factory=dict)
    text_analysis: Dict[str, Any] = field(default_factory=dict)
    category: str = "lifestyle"
    category_cn: str = "生活"
    elapsed_ms: int = 0


ProgressCallback = Callable[[str, str, Optional[Dict[str, Any]]], Coroutine[Any, Any, None]]


def _safe_json_parse(text: str) -> Dict[str, Any]:
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except Exception:
            pass
    return {}


async def _call_agent(
    system_prompt: str,
    user_content: str,
    temperature: float = 0.7,
    settings: Optional[Settings] = None,
    images: Optional[List[str]] = None,
) -> Dict[str, Any]:
    user_msg: Dict[str, Any] = {"role": "user", "content": user_content}
    if images:
        user_msg["images"] = images
    try:
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                user_msg,
            ],
            temperature=temperature,
            settings=settings,
        )
    except Exception:
        if not images:
            raise
        # Some configured chat models are text-only.  Retry with image URLs in
        # text context so diagnosis still completes instead of failing outright.
        resp = await chat_completion(
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": user_content + "\n\n（当前模型未接受图片输入，本轮按图片 URL/数量做文本级视觉判断。）",
                },
            ],
            temperature=temperature,
            settings=settings,
        )
    text = resp.choices[0].message.content or ""
    return _safe_json_parse(text)


def _build_note_context(
    title: str,
    content: str,
    tags: List[str],
    image_count: int,
    category: str,
    *,
    cover_image: str = "",
    images: Optional[List[str]] = None,
) -> str:
    tags_str = " ".join(tags) if tags else "（无标签）"
    images = images or []
    image_lines: List[str] = []
    if cover_image:
        image_lines.append(f"- 封面图：{cover_image}")
    for idx, url in enumerate([x for x in images if x and x != cover_image][:12]):
        image_lines.append(f"- 内容图[{idx}]：{url}")
    if not image_lines:
        image_lines.append("- 无已知图片 URL")
    return (
        f"## 待诊断笔记\n\n"
        f"**标题：** {title}\n\n"
        f"**正文：**\n{content}\n\n"
        f"**标签：** {tags_str}\n\n"
        f"**图片数量：** {image_count}张\n"
        f"**图片清单：**\n" + "\n".join(image_lines) + "\n"
        f"**品类：** {CATEGORY_CN.get(category, category)}\n"
    )


async def run_diagnosis(
    title: str,
    content: str,
    tags: List[str] | None = None,
    image_count: int = 0,
    images: List[str] | None = None,
    cover_image: str = "",
    progress: Optional[ProgressCallback] = None,
    settings: Optional[Settings] = None,
) -> DiagnosisResult:
    """执行完整诊断流程，返回 DiagnosisResult。"""
    start_time = time.time()
    tags = tags or []
    images = images or []
    visual_images = []
    if cover_image:
        visual_images.append(cover_image)
    for url in images:
        if url and url not in visual_images:
            visual_images.append(url)
    visual_images = visual_images[:6]

    async def emit(step: str, message: str, data: Optional[Dict[str, Any]] = None):
        if progress:
            await progress(step, message, data)

    # ─── Step 1: 品类检测 + Model A 预评分 ───
    await emit("detect", "正在检测笔记品类...")
    category = detect_category(title, content, tags)
    category_cn = CATEGORY_CN.get(category, category)

    await emit("model_a", "Model A 预评分中...")
    model_a = pre_score(title, content, category, len(tags), image_count)

    # ─── Step 2: 文本分析 ───
    await emit("text_analysis", "文本特征分析中...")
    text_analysis = full_analysis(title, content, category, tags, image_count)

    # ─── Step 3: 构建笔记上下文 ───
    note_context = _build_note_context(
        title,
        content,
        tags,
        image_count,
        category,
        cover_image=cover_image,
        images=images,
    )
    analysis_context = (
        f"\n\n## 客观数据分析结果\n"
        f"- Model A 总分：{model_a['total_score']}\n"
        f"- 标题得分：{text_analysis['title_analysis']['score']}（钩子数：{text_analysis['title_analysis']['hook_count']}）\n"
        f"- 正文得分：{text_analysis['content_analysis']['score']}（可读性：{text_analysis['content_analysis']['readability_score']}）\n"
        f"- 已知问题：{'、'.join(text_analysis['all_issues'][:5]) if text_analysis['all_issues'] else '无明显问题'}\n"
    )

    # ─── Step 4: 4 Agent 并行评估 ───
    await emit("agents_start", "4位专家开始并行诊断...")

    agent_configs = [
        ("content", CONTENT_AGENT_PROMPT, "内容质量专家"),
        ("visual", VISUAL_AGENT_PROMPT, "视觉诊断师"),
        ("growth", GROWTH_AGENT_PROMPT, "增长策略师"),
        ("user_sim", USER_SIM_AGENT_PROMPT, "用户模拟器"),
    ]

    async def run_single_agent(agent_type: str, prompt: str, name: str) -> Dict[str, Any]:
        data_supplement = build_data_prompt(agent_type, category)
        full_prompt = prompt + data_supplement
        user_msg = note_context + analysis_context
        attached_images = visual_images if agent_type in {"visual", "user_sim"} else []
        result = await _call_agent(full_prompt, user_msg, settings=settings, images=attached_images)
        await emit(f"agent_done_{agent_type}", f"{name}完成评估", {"score": result.get("score", 0)})
        return result

    agent_results = await asyncio.gather(
        *[run_single_agent(t, p, n) for t, p, n in agent_configs],
        return_exceptions=True,
    )

    opinions: List[Dict[str, Any]] = []
    for i, (agent_type, _, name) in enumerate(agent_configs):
        r = agent_results[i]
        if isinstance(r, Exception):
            opinions.append({"agent_name": name, "dimension": agent_type, "score": 50, "issues": [], "suggestions": [], "reasoning": f"评估失败: {r}"})
        else:
            opinions.append(r if isinstance(r, dict) else {"agent_name": name, "score": 50})

    # ─── Step 5: 辩论轮 ───
    await emit("debate_start", "专家辩论中...")

    async def run_debate(agent_idx: int) -> Dict[str, Any]:
        agent_type, _, name = agent_configs[agent_idx]
        other = [
            f"【{opinions[j].get('agent_name', agent_configs[j][2])}】评分{opinions[j].get('score', '?')}分\n"
            f"问题：{json.dumps(opinions[j].get('issues', []), ensure_ascii=False)}\n"
            f"建议：{json.dumps(opinions[j].get('suggestions', []), ensure_ascii=False)}"
            for j in range(len(opinions)) if j != agent_idx
        ]
        debate_prompt = DEBATE_PROMPT.format(
            agent_name=name,
            other_opinions="\n\n".join(other),
        )
        result = await _call_agent(debate_prompt, note_context, temperature=0.6, settings=settings)
        return result

    debate_results = await asyncio.gather(
        *[run_debate(i) for i in range(len(agent_configs))],
        return_exceptions=True,
    )

    debates: List[Dict[str, Any]] = []
    for i, r in enumerate(debate_results):
        if isinstance(r, Exception):
            debates.append({"agent": agent_configs[i][2], "disagreements": [], "agreements": [], "additions": []})
        else:
            debates.append({"agent": agent_configs[i][2], **(r if isinstance(r, dict) else {})})

    await emit("debate_done", "辩论完成")

    # ─── Step 6: 裁判汇总 ───
    await emit("judge_start", "综合裁判汇总中...")

    judge_data_supplement = build_data_prompt("judge", category)
    judge_system = JUDGE_AGENT_PROMPT + judge_data_supplement

    judge_user = (
        note_context + analysis_context +
        f"\n\n## 各专家评估结果\n" +
        "\n\n".join(
            f"### {opinions[i].get('agent_name', agent_configs[i][2])}（{opinions[i].get('score', '?')}分）\n"
            f"问题：{json.dumps(opinions[i].get('issues', []), ensure_ascii=False)}\n"
            f"建议：{json.dumps(opinions[i].get('suggestions', []), ensure_ascii=False)}\n"
            f"推理：{opinions[i].get('reasoning', '')}"
            for i in range(len(opinions))
        ) +
        f"\n\n## 辩论结果\n" +
        "\n".join(
            f"- {debates[i].get('agent', '')}：反驳{json.dumps(debates[i].get('disagreements', []), ensure_ascii=False)}，补充{json.dumps(debates[i].get('additions', []), ensure_ascii=False)}"
            for i in range(len(debates))
        )
    )

    judge_result = await _call_agent(judge_system, judge_user, temperature=0.5, settings=settings)
    await emit("judge_done", "裁判完成")

    # ─── Step 7: 组装结果 ───
    simulated_comments = []
    for op in opinions:
        if "simulated_comments" in op:
            simulated_comments = op["simulated_comments"]
            break

    # 稳定雷达分数：基于 Model A + Agent 评分加权
    model_a_dims = model_a["dimensions"]
    agent_scores = {
        "content": opinions[0].get("score", 50),
        "visual": opinions[1].get("score", 50),
        "growth": opinions[2].get("score", 50),
        "user_reaction": opinions[3].get("score", 50),
    }
    radar = {
        "content": round(model_a_dims["title_quality"] * 0.4 + model_a_dims["content_quality"] * 0.2 + agent_scores["content"] * 0.4),
        "visual": round(model_a_dims["visual_quality"] * 0.4 + agent_scores["visual"] * 0.6),
        "growth": round(model_a_dims["tag_strategy"] * 0.3 + model_a_dims["engagement_potential"] * 0.2 + agent_scores["growth"] * 0.5),
        "user_reaction": round(agent_scores["user_reaction"] * 0.7 + model_a_dims["engagement_potential"] * 0.3),
    }
    radar["overall"] = round(sum(radar.values()) / 4)

    overall_score = judge_result.get("overall_score", radar["overall"])
    grade_map = {range(90, 101): "S", range(75, 90): "A", range(60, 75): "B", range(40, 60): "C", range(0, 40): "D"}
    grade = "C"
    for r, g in grade_map.items():
        if overall_score in r:
            grade = g
            break

    elapsed_ms = int((time.time() - start_time) * 1000)
    await emit("done", f"诊断完成，总分 {overall_score}", {"score": overall_score, "grade": grade})

    return DiagnosisResult(
        overall_score=overall_score,
        grade=judge_result.get("grade", grade),
        radar_data=judge_result.get("radar_data", radar),
        issues=judge_result.get("issues", []),
        suggestions=judge_result.get("suggestions", []),
        debate_summary=judge_result.get("debate_summary", ""),
        optimized_title=judge_result.get("optimized_title", ""),
        optimized_content=judge_result.get("optimized_content", ""),
        optimized_tags=judge_result.get("optimized_tags", []),
        cover_direction=judge_result.get("cover_direction", {}),
        simulated_comments=simulated_comments,
        agent_opinions=opinions,
        debate_results=debates,
        model_a_score=model_a,
        text_analysis=text_analysis,
        category=category,
        category_cn=category_cn,
        elapsed_ms=elapsed_ms,
    )
