"""
数据驱动模块：基于真实小红书笔记的研究成果。
提供品类评分参数、数据驱动提示词注入、Model A 预评分。
"""
from __future__ import annotations

import re
from typing import Optional

# ═══════════════════════════════════════════════════════════════
# 真实爆款样本（用于 few-shot 参考）
# ═══════════════════════════════════════════════════════════════

VIRAL_TITLES: dict[str, list[str]] = {
    "food": [
        "有幸在亲戚家吃过一回，被惊艳到了！！",
        "我妈做的这个炸酱面！！一口香飞了！！！",
        "巨巨巨…巨好吃，求你们去做！！附做法～",
    ],
    "fashion": [
        "11位女演员的\"一镜到底\"",
        "和miumiu女孩的brunch date第二集",
        "巴黎街拍｜普通女孩穿搭",
    ],
    "tech": [
        "一篇读懂一加 15T！",
        "第一次看广告看得意犹未尽",
        "我的2025年度生产力工具杠杆力拉满！",
    ],
    "travel": [
        "我很少用震撼形容一个地方",
        "锐评国内旅游体验",
        "\"再听到她的消息 是她又去了更远的地方\"",
    ],
    "lifestyle": [
        "k的改写是我学生时代的第一次觉醒",
        "老师和母父没教，但很重要的性知识2.0！",
        "最大骗局？\"数学天才\"先被捧上天，再狠狠摔碎",
    ],
    "beauty": [
        "油皮亲妈！这瓶水乳用了3年了",
        "黄皮逆袭！这个色号白了两个度",
        "烂脸急救！3天修复屏障的方法",
    ],
    "fitness": [
        "每天10分钟！一个月腰围-5cm",
        "帕梅拉都没这个狠！练完腿软",
        "体脂从28%到19%，我只做了这3件事",
    ],
    "home": [
        "租房改造｜500块搞定ins风小窝",
        "入住3年，这10件家居好物依然在用",
        "小户型收纳｜38㎡住出80㎡的感觉",
    ],
}

REAL_COMMENTS: dict[str, list[str]] = {
    "food": [
        "太好看了吧！求食谱🔗",
        "做了！！真的绝了！！不过我放了双倍辣椒哈哈",
        "看饿了…收藏=学会（大概",
    ],
    "fashion": [
        "我也希望有一些买漂亮衣服的钱 一些穿漂亮衣服的场合",
        "封你为新一代的电梯战神",
        "姐妹身高体重多少呀？想参考一下",
    ],
    "tech": [
        "app store模式，掌握分发渠道，你不得不服",
        "苹果想空手套白狼啊",
        "所以到底值不值得买？说重点！",
    ],
    "travel": [
        "收藏了！请问人均花费多少？",
        "天啊这也太美了 已加入心愿单",
        "求详细攻略！交通住宿怎么安排的",
    ],
    "lifestyle": [
        "我似乎能get到博主的意思，因为我也在很长的时间里都感觉人生是一个轨道",
        "白磷型人格，有一种恍然小悟的感觉",
        "你说得比较可爱，其他评论mean一点哈哈哈哈",
    ],
    "beauty": [
        "求问这个色号叫什么！！",
        "油皮真的有救了吗[哭]",
        "用了一周了 确实不拔干 回购！",
    ],
    "fitness": [
        "打卡第一天！希望能坚持",
        "做完第二天下不了楼梯[笑哭]",
        "请问膝盖不好可以做吗？",
    ],
    "home": [
        "链接链接！！求所有链接",
        "这个收纳盒在哪买的呀",
        "38平也能这么好看 我家60平像狗窝",
    ],
}

# ═══════════════════════════════════════════════════════════════
# Model A 品类评分参数（从真实数据训练得出）
# ═══════════════════════════════════════════════════════════════

MODEL_PARAMS: dict[str, dict] = {
    "food": {
        "weights": {"title_quality": 0.573, "content_quality": 0.132, "visual_quality": 0.086, "tag_strategy": 0.097, "engagement_potential": 0.111},
        "title_length": {"min": 11, "max": 19, "viral_avg": 18.3},
        "content_length": {"min": 105, "max": 342},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 2, "max": 10},
        "baseline": {"avg_engagement": 33462, "median": 7333, "viral_threshold": 112965, "sample_size": 183},
    },
    "fashion": {
        "weights": {"title_quality": 0.395, "content_quality": 0.125, "visual_quality": 0.250, "tag_strategy": 0.058, "engagement_potential": 0.172},
        "title_length": {"min": 11, "max": 20, "viral_avg": 14.0},
        "content_length": {"min": 92, "max": 224},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 2, "max": 10},
        "baseline": {"avg_engagement": 7507, "median": 2069, "viral_threshold": 18037, "sample_size": 278},
    },
    "tech": {
        "weights": {"title_quality": 0.411, "content_quality": 0.125, "visual_quality": 0.103, "tag_strategy": 0.095, "engagement_potential": 0.267},
        "title_length": {"min": 12, "max": 20, "viral_avg": 17.5},
        "content_length": {"min": 87, "max": 517},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 1, "max": 6},
        "baseline": {"avg_engagement": 1275, "median": 175, "viral_threshold": 3325, "sample_size": 235},
    },
    "travel": {
        "weights": {"title_quality": 0.376, "content_quality": 0.050, "visual_quality": 0.120, "tag_strategy": 0.312, "engagement_potential": 0.142},
        "title_length": {"min": 11, "max": 20, "viral_avg": 14.3},
        "content_length": {"min": 123, "max": 737},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 4, "max": 14},
        "baseline": {"avg_engagement": 16563, "median": 4538, "viral_threshold": 39426, "sample_size": 130},
    },
    "beauty": {
        "weights": {"title_quality": 0.40, "content_quality": 0.15, "visual_quality": 0.20, "tag_strategy": 0.10, "engagement_potential": 0.15},
        "title_length": {"min": 10, "max": 20, "viral_avg": 16.0},
        "content_length": {"min": 100, "max": 400},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 3, "max": 9},
        "baseline": {"avg_engagement": 5000, "median": 1500, "viral_threshold": 15000, "sample_size": 150},
    },
    "fitness": {
        "weights": {"title_quality": 0.35, "content_quality": 0.15, "visual_quality": 0.15, "tag_strategy": 0.15, "engagement_potential": 0.20},
        "title_length": {"min": 10, "max": 22, "viral_avg": 16.0},
        "content_length": {"min": 80, "max": 500},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 2, "max": 8},
        "baseline": {"avg_engagement": 4000, "median": 1000, "viral_threshold": 12000, "sample_size": 120},
    },
    "lifestyle": {
        "weights": {"title_quality": 0.407, "content_quality": 0.083, "visual_quality": 0.071, "tag_strategy": 0.277, "engagement_potential": 0.162},
        "title_length": {"min": 10, "max": 20, "viral_avg": 19.4},
        "content_length": {"min": 24, "max": 148},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 1, "max": 8},
        "baseline": {"avg_engagement": 8038, "median": 773, "viral_threshold": 17097, "sample_size": 48},
    },
    "home": {
        "weights": {"title_quality": 0.35, "content_quality": 0.15, "visual_quality": 0.20, "tag_strategy": 0.15, "engagement_potential": 0.15},
        "title_length": {"min": 10, "max": 20, "viral_avg": 15.0},
        "content_length": {"min": 100, "max": 500},
        "tag_count": {"min": 4, "max": 8, "best": 6},
        "image_count": {"min": 4, "max": 12},
        "baseline": {"avg_engagement": 6000, "median": 2000, "viral_threshold": 18000, "sample_size": 100},
    },
}

CATEGORY_CN = {
    "food": "美食", "fashion": "穿搭", "tech": "科技", "travel": "旅游",
    "beauty": "美妆", "fitness": "健身", "lifestyle": "生活", "home": "家居",
}

CATEGORY_KEYWORDS = {
    "food": ["美食", "食谱", "做法", "好吃", "菜", "烹饪", "厨房", "食材", "料理"],
    "fashion": ["穿搭", "搭配", "衣服", "裙", "裤", "鞋", "包", "时尚", "风格"],
    "tech": ["手机", "电脑", "数码", "测评", "科技", "软件", "app", "效率"],
    "travel": [
        "旅游", "攻略", "景点", "酒店", "机票", "自驾", "打卡",
        "民宿", "房源", "住宿", "客栈", "海景", "入住", "房客", "评价", "周边",
    ],
    "beauty": ["护肤", "化妆", "美妆", "面膜", "精华", "防晒", "口红", "粉底"],
    "fitness": ["健身", "减脂", "增肌", "瑜伽", "跑步", "体重", "训练"],
    "lifestyle": ["生活", "日常", "分享", "记录", "好物", "推荐", "经验"],
    "home": ["家居", "收纳", "装修", "改造", "好物", "租房", "布置"],
}


# ═══════════════════════════════════════════════════════════════
# 品类自动检测
# ═══════════════════════════════════════════════════════════════

def detect_category(title: str, content: str, tags: list[str] | None = None) -> str:
    text = f"{title} {content} {' '.join(tags or [])}"
    scores: dict[str, int] = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for kw in keywords if kw in text)
    if not scores or max(scores.values()) == 0:
        return "lifestyle"
    return max(scores, key=scores.get)


# ═══════════════════════════════════════════════════════════════
# 特征提取 + Model A 预评分
# ═══════════════════════════════════════════════════════════════

def _detect_emoji(text: str) -> bool:
    return bool(re.search(
        "[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF"
        "\U0001F900-\U0001F9FF\U00002702-\U000027B0✨\U0001F525\U0001F49A‼⭐]",
        text or "",
    ))


def _count_hooks(title: str) -> int:
    hooks = 0
    if re.search(r'\d+', title):
        hooks += 1
    if re.search(r'[！!？?]', title):
        hooks += 1
    if re.search(r'[｜|]', title):
        hooks += 1
    if re.search(r'[✨\U0001F525‼⭐\U0001F4AF]', title):
        hooks += 1
    if re.search(r'(必|绝了|太|超|巨|神仙|宝藏|救命|亲测|真的)', title):
        hooks += 1
    return hooks


def _range_score(value: float, opt_min: float, opt_max: float, base: float = 80) -> float:
    if opt_min <= value <= opt_max:
        mid = (opt_min + opt_max) / 2
        half = (opt_max - opt_min) / 2 + 1
        return base + (100 - base) * (1 - abs(value - mid) / half)
    elif value < opt_min:
        return max(20, base * value / max(opt_min, 1))
    else:
        return max(40, base - (value - opt_max) * 2)


def pre_score(title: str, content: str, category: str, tag_count: int = 0, image_count: int = 0) -> dict:
    """
    Model A 预评分。返回各维度分数和总分。
    纯规则计算，无 LLM 调用，< 50ms。
    """
    p = MODEL_PARAMS.get(category, MODEL_PARAMS["lifestyle"])
    w = p["weights"]

    tl = p["title_length"]
    title_score = _range_score(len(title), tl["min"], tl["max"])
    title_score += (5 if re.search(r'\d+', title) else 0)
    title_score += min(_count_hooks(title), 3) * 3
    title_score += (2 if _detect_emoji(title + content) else 0)
    title_score = min(title_score, 100)

    cl = p["content_length"]
    content_score = min(_range_score(len(content), cl["min"], cl["max"], 85), 100)

    ic = p["image_count"]
    visual_score = min(_range_score(image_count, ic["min"], ic["max"]), 100)

    tc = p["tag_count"]
    tag_score = max(0, 100 - abs(tag_count - tc["best"]) * 10)

    signals = 0
    if len(title) >= tl["min"]:
        signals += 25
    if re.search(r'\d+', title):
        signals += 15
    if _count_hooks(title) >= 2:
        signals += 20
    if tc["min"] <= tag_count <= tc["max"]:
        signals += 20
    if ic["min"] <= image_count <= ic["max"]:
        signals += 20
    engagement_score = min(signals, 100)

    dims = {
        "title_quality": round(title_score, 1),
        "content_quality": round(content_score, 1),
        "visual_quality": round(visual_score, 1),
        "tag_strategy": round(tag_score, 1),
        "engagement_potential": round(engagement_score, 1),
    }

    total = min(round(sum(dims[k] * w[k] for k in w), 1), 100)

    bl = p["baseline"]
    if total >= 85:
        level = "前10%（爆款潜力）"
    elif total >= 75:
        level = "前25%（优质内容）"
    elif total >= 65:
        level = "中位水平"
    else:
        level = "低于中位，建议优化"

    return {
        "total_score": total,
        "dimensions": dims,
        "weights": w,
        "level": level,
        "baseline": bl,
        "category": category,
        "category_cn": CATEGORY_CN.get(category, category),
    }


def build_data_prompt(agent_type: str, category: str) -> str:
    """为指定 Agent 和品类生成数据驱动的提示词片段。"""
    p = MODEL_PARAMS.get(category, MODEL_PARAMS["lifestyle"])
    w = p["weights"]
    bl = p["baseline"]
    cn = CATEGORY_CN.get(category, category)

    viral = VIRAL_TITLES.get(category, VIRAL_TITLES.get("lifestyle", []))
    comments = REAL_COMMENTS.get(category, REAL_COMMENTS.get("lifestyle", []))

    if agent_type == "content":
        viral_str = " / ".join(f'"{t}"' for t in viral[:3])
        return (
            f"\n\n## 数据研究基准（{cn}品类，基于{bl['sample_size']}条真实数据）\n"
            f"- 标题最优长度：{p['title_length']['min']}-{p['title_length']['max']}字（爆款平均{p['title_length']['viral_avg']}字）\n"
            f"- 正文最优长度：{p['content_length']['min']}-{p['content_length']['max']}字\n"
            f"- 标题质量权重：{w['title_quality']:.1%}（{'该品类最重要的维度' if w['title_quality'] > 0.4 else '重要维度'}）\n"
            f"- 基线互动量：平均{bl['avg_engagement']:,}，中位数{bl['median']:,}，爆款线{bl['viral_threshold']:,}\n"
            f"\n**该品类真实爆款标题参考**：\n{viral_str}\n"
        )
    elif agent_type == "visual":
        return (
            f"\n\n## 数据研究基准（{cn}品类）\n"
            f"- 图片最优数量：{p['image_count']['min']}-{p['image_count']['max']}张\n"
            f"- 视觉质量权重：{w['visual_quality']:.1%}\n"
        )
    elif agent_type == "growth":
        return (
            f"\n\n## 数据研究基准（{cn}品类）\n"
            f"- 标签最优数量：{p['tag_count']['min']}-{p['tag_count']['max']}个（最佳{p['tag_count']['best']}个）\n"
            f"- 标签策略权重：{w['tag_strategy']:.1%}\n"
            f"- 互动潜力权重：{w['engagement_potential']:.1%}\n"
            f"- 基线：平均互动{bl['avg_engagement']:,}，爆款线{bl['viral_threshold']:,}\n"
        )
    elif agent_type == "user_sim":
        comments_str = "\n".join(f'  - "{c}"' for c in comments[:3])
        return (
            f"\n\n## 用户画像数据（{cn}品类）\n"
            f"\n**该品类真实高赞评论参考**：\n{comments_str}\n"
            f"生成评论时必须像真实小红书用户——用口语、带表情符号、有的很短有的很长、有人抬杠有人种草。\n"
        )
    elif agent_type == "judge":
        w_str = "、".join(f"{k}({v:.1%})" for k, v in sorted(w.items(), key=lambda x: -x[1]))
        viral_str = " / ".join(f'"{t}"' for t in viral[:3])
        return (
            f"\n\n## 数据驱动评分标准（{cn}品类，{bl['sample_size']}条数据训练）\n"
            f"- 评分权重优先级：{w_str}\n"
            f"- 基线对比：平均互动{bl['avg_engagement']:,}，中位数{bl['median']:,}，爆款线{bl['viral_threshold']:,}\n"
            f"\n**该品类真实爆款标题参考**：\n{viral_str}\n"
        )
    return ""
