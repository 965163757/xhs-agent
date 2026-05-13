import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.agents.banned_words import check_banned_words
from app.agents.tools import (
    _article_image_context,
    _article_payload,
    _infer_image_size_from_request,
    _normalize_score_payload,
    _normalize_tags,
    _score_for_article,
)
from app.config import Settings
from app.database import Article, ArticleDiagnosis
from app.time_utils import beijing_iso, parse_beijing_datetime_to_naive


class ArticleVisualAndScoreTests(unittest.TestCase):
    def test_first_content_image_is_effective_cover(self):
        art = Article(
            title="北京3天不踩坑攻略",
            body="第一天故宫天安门，第二天天坛胡同，第三天长城颐和园。",
            tags="#北京,#旅游,#攻略,#故宫,#长城",
            cover_image="",
            images=["/static/images/a.png", "/static/images/b.png"],
        )

        ctx = _article_image_context(art)
        payload = _article_payload(art)

        self.assertTrue(ctx["has_cover"])
        self.assertFalse(ctx["stored_has_cover"])
        self.assertEqual(ctx["cover_image"], "/static/images/a.png")
        self.assertEqual(ctx["visual_images"][0]["role"], "cover")
        self.assertEqual(ctx["visual_images"][0]["position"], 0)
        self.assertEqual(payload["cover_image"], "/static/images/a.png")
        self.assertEqual(payload["images"], ["/static/images/b.png"])

    def test_article_payload_exposes_full_public_image_urls(self):
        art = Article(
            title="带图笔记",
            body="正文",
            tags="#测试",
            cover_image="/static/images/a.png",
            images=["/static/images/b.png"],
        )

        with patch("app.agents.tools.get_settings", return_value=Settings(public_base_url="https://xhs.example.com/app")):
            ctx = _article_image_context(art)
            payload = _article_payload(art)

        self.assertEqual(ctx["cover_image"], "/static/images/a.png")
        self.assertEqual(ctx["cover_image_full_url"], "https://xhs.example.com/app/static/images/a.png")
        self.assertEqual(ctx["content_images"][0]["full_url"], "https://xhs.example.com/app/static/images/b.png")
        self.assertEqual(ctx["visual_images"][0]["model_url"], "https://xhs.example.com/app/static/images/a.png")
        self.assertEqual(payload["cover_image"], "/static/images/a.png")
        self.assertEqual(payload["cover_image_full_url"], "https://xhs.example.com/app/static/images/a.png")
        self.assertEqual(payload["images_full_urls"], ["https://xhs.example.com/app/static/images/b.png"])

    def test_score_for_article_always_has_five_dimensions(self):
        art = Article(
            title="北京3天不踩坑攻略",
            body="路线、交通、住宿、美食、拍照机位和避坑提醒都整理好了，适合第一次去北京的姐妹收藏。",
            tags="#北京,#北京旅游,#旅游攻略,#故宫,#长城,#天坛",
            cover_image="",
            images=[
                "/static/images/cover.png",
                "/static/images/route.png",
                "/static/images/food.png",
                "/static/images/tips.png",
            ],
        )

        score = _score_for_article(art)
        for key in ("content", "visual", "growth", "engagement", "overall"):
            self.assertIsInstance(score[key], int)
            self.assertGreater(score[key], 0)
            self.assertLessEqual(score[key], 100)

        normalized = _normalize_score_payload({"overall": 88}, score)
        self.assertEqual(normalized["overall"], 88)
        for key in ("content", "visual", "growth", "engagement"):
            self.assertGreater(normalized[key], 0)

    def test_diagnosis_to_dict_exposes_history_metadata(self):
        diag = ArticleDiagnosis(
            id=12,
            article_id=34,
            user_id=1,
            report={"overall_score": 88, "grade": "A", "optimized_title": "新标题"},
            created_at=datetime(2026, 5, 13, 16, 30, 0),
        )

        data = diag.to_dict()

        self.assertEqual(data["id"], 12)
        self.assertEqual(data["diagnosis_id"], 12)
        self.assertEqual(data["article_id"], 34)
        self.assertEqual(data["overall_score"], 88)
        self.assertEqual(data["optimized_title"], "新标题")
        self.assertEqual(data["created_at"], "2026-05-13T16:30:00+08:00")

    def test_time_helpers_use_beijing_timezone(self):
        self.assertEqual(
            beijing_iso(datetime(2026, 5, 13, 16, 30, 0)),
            "2026-05-13T16:30:00+08:00",
        )
        self.assertEqual(
            beijing_iso(datetime(2026, 5, 13, 8, 30, 0, tzinfo=timezone.utc)),
            "2026-05-13T16:30:00+08:00",
        )
        self.assertEqual(
            parse_beijing_datetime_to_naive("2026-05-13T16:30:00+08:00"),
            datetime(2026, 5, 13, 16, 30, 0),
        )

    def test_tags_are_normalized_without_duplicate_hashes(self):
        self.assertEqual(_normalize_tags(["#旅行", "##攻略", "旅行", " 美食 "]), ["旅行", "攻略", "美食"])

    def test_banned_words_deduplicate_repeated_terms(self):
        result = check_banned_words("最好最好最好，唯一唯一")
        words = [h.word for h in result.hits]
        self.assertEqual(words.count("最好"), 1)
        self.assertEqual(words.count("唯一"), 1)

    def test_image_size_inference_respects_resolution_and_ratio(self):
        self.assertEqual(_infer_image_size_from_request("小红书海报 2K 3:4 竖版", "1024x1536"), "1536x2048")
        self.assertEqual(_infer_image_size_from_request("横版 4K 16:9", None), "4096x2304")
        self.assertEqual(_infer_image_size_from_request("精确 2048x1152", None), "2048x1152")
        self.assertEqual(_infer_image_size_from_request("普通封面", "1024x1536"), "1152x1536")


if __name__ == "__main__":
    unittest.main()
