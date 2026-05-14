import unittest

from app.agents import tools
from app.agents.runner import SYSTEM_PROMPT
from app.agents.research_data import detect_category


class CopywritingPromptingTests(unittest.TestCase):
    def test_original_creation_uses_listing_and_review_material(self):
        material = tools._collect_creation_material(
            {
                "listing_info": "威海海景民宿，步行到海边 5 分钟，有落地窗",
                "guest_reviews": "房客评价：早上能看到日出，房间干净，楼下吃饭方便",
                "extra": "目标受众 20-40 岁女性",
            }
        )
        self.assertIn("【房源/产品信息】", material)
        self.assertIn("【用户/房客评价】", material)
        self.assertIn("落地窗", material)
        self.assertIn("日出", material)

    def test_prompts_distinguish_original_and_rewrite_quality(self):
        self.assertIn("房源信息/产品信息/服务信息/用户评价/房客评价", tools.XHS_WRITER_SYSTEM)
        self.assertIn("改写不是缩写", tools.XHS_WRITER_SYSTEM)
        self.assertIn("降低与原帖的连续文本和关键词重复", tools.XHS_WRITER_SYSTEM)
        self.assertIn("source_material/listing_info/guest_reviews", SYSTEM_PROMPT)

    def test_homestay_copy_is_classified_as_travel(self):
        self.assertEqual(
            detect_category("威海海景民宿", "房源信息：海景落地窗。房客评价：适合看日出", []),
            "travel",
        )

    def test_tool_schemas_accept_source_material(self):
        gen_props = tools.TOOLS["generate_article"]["schema"]["function"]["parameters"]["properties"]
        workflow_props = tools.TOOLS["create_complete_note_workflow"]["schema"]["function"]["parameters"]["properties"]
        rewrite_props = tools.TOOLS["rewrite_article"]["schema"]["function"]["parameters"]["properties"]
        for props in (gen_props, workflow_props):
            self.assertIn("source_material", props)
            self.assertIn("listing_info", props)
            self.assertIn("guest_reviews", props)
        self.assertIn("降低原帖连续文本/关键词重复", rewrite_props["instruction"]["description"])


if __name__ == "__main__":
    unittest.main()
