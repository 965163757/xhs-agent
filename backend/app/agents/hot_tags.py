"""
小红书热门标签库。
提供标签自动补全、热度分级、品类推荐。
"""
from __future__ import annotations

from typing import List

# 热度等级: S=100w+ A=50w-100w B=10w-50w C=1w-10w
# 格式: (标签, 热度等级, 品类)

HOT_TAGS: list[tuple[str, str, str]] = [
    # 美食
    ("#美食分享", "S", "food"),
    ("#美食推荐", "S", "food"),
    ("#家常菜", "A", "food"),
    ("#减脂餐", "A", "food"),
    ("#烘焙", "A", "food"),
    ("#早餐", "A", "food"),
    ("#下午茶", "B", "food"),
    ("#空气炸锅", "B", "food"),
    ("#一人食", "B", "food"),
    ("#快手菜", "B", "food"),
    ("#懒人菜谱", "B", "food"),
    ("#宿舍美食", "C", "food"),
    ("#低卡美食", "C", "food"),
    ("#厨房好物", "C", "food"),
    ("#做饭日常", "C", "food"),

    # 穿搭
    ("#穿搭灵感", "S", "fashion"),
    ("#穿搭分享", "S", "fashion"),
    ("#日常穿搭", "A", "fashion"),
    ("#通勤穿搭", "A", "fashion"),
    ("#小个子穿搭", "A", "fashion"),
    ("#微胖穿搭", "A", "fashion"),
    ("#韩系穿搭", "B", "fashion"),
    ("#法式穿搭", "B", "fashion"),
    ("#梨形身材穿搭", "B", "fashion"),
    ("#学生党穿搭", "B", "fashion"),
    ("#约会穿搭", "B", "fashion"),
    ("#显瘦穿搭", "B", "fashion"),
    ("#秋冬穿搭", "B", "fashion"),
    ("#春夏穿搭", "B", "fashion"),
    ("#极简穿搭", "C", "fashion"),

    # 美妆护肤
    ("#护肤分享", "S", "beauty"),
    ("#好物推荐", "S", "beauty"),
    ("#平价护肤", "A", "beauty"),
    ("#油皮护肤", "A", "beauty"),
    ("#干皮护肤", "A", "beauty"),
    ("#敏感肌", "A", "beauty"),
    ("#防晒推荐", "A", "beauty"),
    ("#面膜推荐", "B", "beauty"),
    ("#精华液", "B", "beauty"),
    ("#水乳推荐", "B", "beauty"),
    ("#学生党护肤", "B", "beauty"),
    ("#抗老护肤", "B", "beauty"),
    ("#妆容分享", "A", "beauty"),
    ("#日常妆容", "B", "beauty"),
    ("#新手化妆", "B", "beauty"),

    # 健身
    ("#健身打卡", "A", "fitness"),
    ("#减脂", "A", "fitness"),
    ("#瘦腿", "A", "fitness"),
    ("#瘦肚子", "A", "fitness"),
    ("#帕梅拉", "B", "fitness"),
    ("#居家健身", "B", "fitness"),
    ("#瑜伽", "B", "fitness"),
    ("#跑步", "B", "fitness"),
    ("#体态矫正", "B", "fitness"),
    ("#增肌", "C", "fitness"),
    ("#马甲线", "C", "fitness"),
    ("#拉伸", "C", "fitness"),

    # 旅游
    ("#旅行攻略", "S", "travel"),
    ("#旅游推荐", "S", "travel"),
    ("#周末去哪玩", "A", "travel"),
    ("#自驾游", "A", "travel"),
    ("#露营", "A", "travel"),
    ("#拍照打卡", "A", "travel"),
    ("#小众旅行地", "B", "travel"),
    ("#citywalk", "B", "travel"),
    ("#海岛游", "B", "travel"),
    ("#亲子游", "B", "travel"),
    ("#穷游攻略", "C", "travel"),
    ("#一日游", "C", "travel"),

    # 科技数码
    ("#数码好物", "A", "tech"),
    ("#手机测评", "A", "tech"),
    ("#效率工具", "B", "tech"),
    ("#iPad", "B", "tech"),
    ("#电脑推荐", "B", "tech"),
    ("#App推荐", "B", "tech"),
    ("#生产力工具", "C", "tech"),
    ("#桌面搭建", "C", "tech"),
    ("#摄影器材", "C", "tech"),

    # 家居
    ("#家居好物", "S", "home"),
    ("#租房改造", "A", "home"),
    ("#收纳整理", "A", "home"),
    ("#装修灵感", "A", "home"),
    ("#小户型", "B", "home"),
    ("#ins风", "B", "home"),
    ("#卧室改造", "B", "home"),
    ("#厨房收纳", "C", "home"),
    ("#浴室好物", "C", "home"),

    # 生活
    ("#生活分享", "S", "lifestyle"),
    ("#好物分享", "S", "lifestyle"),
    ("#学习方法", "A", "lifestyle"),
    ("#自律", "A", "lifestyle"),
    ("#考研", "A", "lifestyle"),
    ("#职场", "B", "lifestyle"),
    ("#副业", "B", "lifestyle"),
    ("#理财", "B", "lifestyle"),
    ("#情绪管理", "B", "lifestyle"),
    ("#独居生活", "B", "lifestyle"),
    ("#极简生活", "C", "lifestyle"),
    ("#时间管理", "C", "lifestyle"),
    ("#读书笔记", "C", "lifestyle"),
]

HEAT_LABEL = {"S": "100w+", "A": "50w+", "B": "10w+", "C": "1w+"}


def suggest_tags(query: str = "", category: str = "", limit: int = 20) -> List[dict]:
    """根据输入和品类推荐标签。"""
    results = []
    query_lower = query.lower().replace("#", "")

    for tag, heat, cat in HOT_TAGS:
        if category and cat != category:
            continue
        tag_text = tag.replace("#", "").lower()
        if query_lower and query_lower not in tag_text:
            continue
        results.append({
            "tag": tag,
            "heat": heat,
            "heat_label": HEAT_LABEL[heat],
            "category": cat,
        })

    # 按热度排序
    heat_order = {"S": 0, "A": 1, "B": 2, "C": 3}
    results.sort(key=lambda x: heat_order.get(x["heat"], 9))
    return results[:limit]


def get_category_tags(category: str, limit: int = 10) -> List[dict]:
    """获取指定品类的推荐标签组合。"""
    return suggest_tags(query="", category=category, limit=limit)
