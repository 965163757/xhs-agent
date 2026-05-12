"""
小红书违禁词/敏感词库。
本地规则检测，不依赖 LLM，实时返回结果。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

# ═══════════════════════════════════════════════════════════════
# 违禁词分类
# ═══════════════════════════════════════════════════════════════

# 绝对化用语（广告法禁用）
ABSOLUTE_WORDS = [
    "最好", "最佳", "最优", "最强", "最大", "最小", "最高", "最低",
    "第一", "唯一", "首个", "首选", "独一无二", "绝无仅有",
    "全网最低", "史上最", "世界级", "国家级", "顶级", "极致",
    "万能", "100%", "百分百", "零风险", "无副作用",
]

# 医疗/健康违规词
MEDICAL_WORDS = [
    "治疗", "治愈", "根治", "药效", "疗效", "处方", "门诊",
    "消炎", "抗菌", "杀菌", "抑菌", "排毒", "解毒",
    "祛痘", "祛斑", "美白", "减肥", "瘦身", "丰胸",
    "降血压", "降血糖", "降血脂", "抗癌", "防癌",
    "速效", "立竿见影", "药到病除", "包治百病",
]

# 金融/收益违规词
FINANCE_WORDS = [
    "保本", "保收益", "稳赚", "躺赚", "日入过万", "月入百万",
    "零风险投资", "高回报", "翻倍", "暴富", "财务自由",
    "内部消息", "稳赚不赔", "保证收益",
]

# 引流/诱导词
TRAFFIC_WORDS = [
    "加微信", "加V", "加vx", "私聊", "私我", "私信领取",
    "点击链接", "复制口令", "淘口令", "拼多多",
    "免费领", "0元领", "扫码", "二维码",
]

# 虚假宣传词
FALSE_CLAIM_WORDS = [
    "明星同款", "央视推荐", "国家认证", "专利配方",
    "销量第一", "全网热销", "断货王", "秒杀",
    "假一赔十", "正品保证", "官方授权",
]

# 敏感话题词
SENSITIVE_WORDS = [
    "代购", "水货", "A货", "高仿", "复刻", "原单",
    "刷单", "好评返现", "互赞", "互粉",
]

# 替代建议映射
REPLACEMENTS: dict[str, str] = {
    "最好": "很不错/强烈推荐",
    "最佳": "非常适合/优选",
    "第一": "领先/头部",
    "唯一": "少有的/难得的",
    "祛痘": "肌肤调理/痘肌护理",
    "祛斑": "淡化瑕疵/提亮肤色",
    "美白": "提亮/透亮/亮肤",
    "减肥": "身材管理/体重管理",
    "瘦身": "塑形/体态管理",
    "治疗": "改善/调理/缓解",
    "治愈": "修复/改善",
    "排毒": "代谢调理",
    "消炎": "舒缓/镇静",
    "抗菌": "清洁/净化",
    "速效": "见效快/效率高",
    "加微信": "（禁止引流外站）",
    "加V": "（禁止引流外站）",
    "私聊": "评论区留言",
    "免费领": "限时优惠/福利",
    "丰胸": "胸部护理",
    "降血压": "辅助健康管理",
    "保本": "（禁止承诺收益）",
    "稳赚": "（禁止承诺收益）",
    "明星同款": "XX风格/类似款",
    "央视推荐": "（需提供授权证明）",
}


@dataclass
class BannedWordHit:
    word: str
    category: str
    position: int
    replacement: str = ""
    severity: str = "high"  # high / medium / low


@dataclass
class BanCheckResult:
    hits: List[BannedWordHit] = field(default_factory=list)
    safe: bool = True
    summary: str = ""

    def to_dict(self) -> dict:
        return {
            "safe": self.safe,
            "hit_count": len(self.hits),
            "summary": self.summary,
            "hits": [
                {
                    "word": h.word,
                    "category": h.category,
                    "position": h.position,
                    "replacement": h.replacement,
                    "severity": h.severity,
                }
                for h in self.hits
            ],
        }


_CATEGORY_MAP = [
    (ABSOLUTE_WORDS, "绝对化用语", "high"),
    (MEDICAL_WORDS, "医疗违规", "high"),
    (FINANCE_WORDS, "金融违规", "high"),
    (TRAFFIC_WORDS, "引流诱导", "high"),
    (FALSE_CLAIM_WORDS, "虚假宣传", "medium"),
    (SENSITIVE_WORDS, "敏感话题", "medium"),
]


def check_banned_words(text: str) -> BanCheckResult:
    """检测文本中的违禁词，返回所有命中项。"""
    if not text:
        return BanCheckResult(safe=True, summary="文本为空")

    hits: List[BannedWordHit] = []
    text_lower = text.lower()

    for word_list, category, severity in _CATEGORY_MAP:
        for word in word_list:
            word_lower = word.lower()
            start = 0
            while True:
                pos = text_lower.find(word_lower, start)
                if pos == -1:
                    break
                hits.append(BannedWordHit(
                    word=word,
                    category=category,
                    position=pos,
                    replacement=REPLACEMENTS.get(word, ""),
                    severity=severity,
                ))
                start = pos + len(word)

    safe = len(hits) == 0
    if safe:
        summary = "未检测到违禁词"
    else:
        categories = list(set(h.category for h in hits))
        summary = f"检测到 {len(hits)} 个违禁词，涉及：{'、'.join(categories)}"

    return BanCheckResult(hits=hits, safe=safe, summary=summary)


def get_all_banned_words() -> dict:
    """返回所有违禁词分类，供前端使用。"""
    return {
        "absolute": ABSOLUTE_WORDS,
        "medical": MEDICAL_WORDS,
        "finance": FINANCE_WORDS,
        "traffic": TRAFFIC_WORDS,
        "false_claim": FALSE_CLAIM_WORDS,
        "sensitive": SENSITIVE_WORDS,
        "replacements": REPLACEMENTS,
    }
