"""
文本分析器：对标题和正文进行结构化特征提取。
不依赖 LLM，纯规则分析，用于为 Agent 提供客观数据支撑。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List


@dataclass
class TitleAnalysis:
    length: int = 0
    has_number: bool = False
    has_emoji: bool = False
    has_punctuation_hook: bool = False
    has_separator: bool = False
    has_power_word: bool = False
    hook_count: int = 0
    keywords: List[str] = field(default_factory=list)
    issues: List[str] = field(default_factory=list)
    score: float = 0.0


@dataclass
class ContentAnalysis:
    length: int = 0
    paragraph_count: int = 0
    avg_sentence_length: float = 0.0
    emoji_count: int = 0
    has_interaction_guide: bool = False
    has_list_structure: bool = False
    readability_score: float = 0.0
    issues: List[str] = field(default_factory=list)
    score: float = 0.0


POWER_WORDS = [
    "必", "绝了", "太", "超", "巨", "神仙", "宝藏", "救命", "亲测", "真的",
    "居然", "竟然", "万万没想到", "后悔", "早知道", "终于", "原来", "秘密",
    "偷偷", "疯了", "炸了", "哭了", "笑死", "离谱", "逆天", "封神",
]

INTERACTION_PATTERNS = [
    r"评论区", r"你们觉得", r"有没有", r"求推荐", r"收藏",
    r"转发", r"关注", r"点赞", r"试试", r"分享",
    r"留言", r"告诉我", r"你也", r"一起", r"投票",
]

EMOJI_PATTERN = re.compile(
    "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
    "\U0001F900-\U0001F9FF\U00002702-\U000027B0"
    "\U0001F1E0-\U0001F1FF\U00002600-\U000026FF"
    "✨🔥💡📌❗❤️💪🎉🎊👏🙌💯🌟⭐🏆💎🎯📍🔗✅❌⚡🌈🍃🌸💐🌺"
    "🧡💛💚💙💜🖤🤍🤎♥️💕💗💖💝💘]"
)


def analyze_title(title: str, category: str = "lifestyle") -> TitleAnalysis:
    from .research_data import MODEL_PARAMS

    result = TitleAnalysis()
    result.length = len(title)
    result.has_number = bool(re.search(r'\d+', title))
    result.has_emoji = bool(EMOJI_PATTERN.search(title))
    result.has_punctuation_hook = bool(re.search(r'[！!？?…]', title))
    result.has_separator = bool(re.search(r'[｜|丨·]', title))
    result.has_power_word = any(w in title for w in POWER_WORDS)

    hooks = 0
    if result.has_number:
        hooks += 1
    if result.has_punctuation_hook:
        hooks += 1
    if result.has_separator:
        hooks += 1
    if result.has_emoji:
        hooks += 1
    if result.has_power_word:
        hooks += 1
    result.hook_count = hooks

    params = MODEL_PARAMS.get(category, MODEL_PARAMS["lifestyle"])
    tl = params["title_length"]

    score = 50.0
    if tl["min"] <= result.length <= tl["max"]:
        score += 20
    elif result.length < tl["min"]:
        result.issues.append(f"标题过短（{result.length}字），建议{tl['min']}-{tl['max']}字")
        score -= 10
    else:
        result.issues.append(f"标题过长（{result.length}字），建议{tl['min']}-{tl['max']}字")
        score -= 5

    score += min(hooks, 3) * 10

    if not result.has_number:
        result.issues.append("标题缺少数字，含数字标题互动率高25%")
    if not result.has_power_word and not result.has_punctuation_hook:
        result.issues.append("标题缺少情绪钩子词或感叹/疑问标点")

    result.score = min(max(score, 0), 100)
    return result


def analyze_content(content: str, category: str = "lifestyle") -> ContentAnalysis:
    from .research_data import MODEL_PARAMS

    result = ContentAnalysis()
    result.length = len(content)

    paragraphs = [p.strip() for p in content.split('\n') if p.strip()]
    result.paragraph_count = len(paragraphs)

    sentences = re.split(r'[。！？!?；;，,\n]', content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 1]
    if sentences:
        result.avg_sentence_length = sum(len(s) for s in sentences) / len(sentences)

    result.emoji_count = len(EMOJI_PATTERN.findall(content))
    result.has_interaction_guide = any(
        re.search(p, content) for p in INTERACTION_PATTERNS
    )
    result.has_list_structure = bool(re.search(
        r'(^\d+[.、）)]|^[-•·]|^[①②③④⑤⑥⑦⑧⑨⑩])', content, re.MULTILINE
    ))

    params = MODEL_PARAMS.get(category, MODEL_PARAMS["lifestyle"])
    cl = params["content_length"]

    score = 50.0

    if cl["min"] <= result.length <= cl["max"]:
        score += 15
    elif result.length < cl["min"]:
        result.issues.append(f"正文过短（{result.length}字），建议{cl['min']}-{cl['max']}字")
        score -= 10
    else:
        result.issues.append(f"正文偏长（{result.length}字），建议精简至{cl['max']}字内")
        score -= 5

    if result.avg_sentence_length <= 20:
        score += 10
    elif result.avg_sentence_length > 30:
        result.issues.append("句子偏长，建议拆短句增加节奏感")
        score -= 5

    if result.emoji_count >= 3:
        score += 5
    elif result.emoji_count == 0:
        result.issues.append("缺少emoji，视觉单调")

    if result.has_interaction_guide:
        score += 10
    else:
        result.issues.append("缺少互动引导句（提问/求分享/投票）")

    if result.has_list_structure:
        score += 5

    if result.paragraph_count >= 3:
        score += 5
    elif result.paragraph_count <= 1:
        result.issues.append("缺少分段，建议每2-3句换行")
        score -= 5

    readability = 100.0
    if result.avg_sentence_length > 25:
        readability -= (result.avg_sentence_length - 25) * 3
    if result.paragraph_count <= 1 and result.length > 100:
        readability -= 20
    if result.emoji_count == 0:
        readability -= 10
    result.readability_score = max(0, min(100, readability))

    result.score = min(max(score, 0), 100)
    return result


def full_analysis(title: str, content: str, category: str, tags: list[str] | None = None, image_count: int = 0) -> dict:
    """完整文本分析，返回结构化数据供 Agent 使用。"""
    from .research_data import pre_score, MODEL_PARAMS

    title_result = analyze_title(title, category)
    content_result = analyze_content(content, category)
    model_a = pre_score(title, content, category, len(tags or []), image_count)

    params = MODEL_PARAMS.get(category, MODEL_PARAMS["lifestyle"])
    tag_count = len(tags or [])
    tc = params["tag_count"]

    tag_issues = []
    if tag_count < tc["min"]:
        tag_issues.append(f"标签仅{tag_count}个，建议增至{tc['best']}个")
    elif tag_count > tc["max"]:
        tag_issues.append(f"标签{tag_count}个偏多，建议精简至{tc['best']}个")

    return {
        "title_analysis": {
            "length": title_result.length,
            "hook_count": title_result.hook_count,
            "has_number": title_result.has_number,
            "has_emoji": title_result.has_emoji,
            "has_power_word": title_result.has_power_word,
            "score": title_result.score,
            "issues": title_result.issues,
        },
        "content_analysis": {
            "length": content_result.length,
            "paragraph_count": content_result.paragraph_count,
            "avg_sentence_length": round(content_result.avg_sentence_length, 1),
            "emoji_count": content_result.emoji_count,
            "has_interaction_guide": content_result.has_interaction_guide,
            "readability_score": round(content_result.readability_score, 1),
            "score": content_result.score,
            "issues": content_result.issues,
        },
        "tag_analysis": {
            "count": tag_count,
            "optimal": tc["best"],
            "issues": tag_issues,
        },
        "image_analysis": {
            "count": image_count,
            "optimal_min": params["image_count"]["min"],
            "optimal_max": params["image_count"]["max"],
        },
        "model_a_score": model_a,
        "all_issues": title_result.issues + content_result.issues + tag_issues,
    }
