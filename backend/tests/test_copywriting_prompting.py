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

    def test_imitate_distinguishes_reference_style_from_new_topic(self):
        imitate = tools.TOOLS["imitate_article_style"]["schema"]["function"]
        self.assertIn("新主题", imitate["description"])
        self.assertIn("北京攻略写上海攻略", imitate["description"])
        self.assertIn("缺少新主题", imitate["description"])
        self.assertIn("新主题", SYSTEM_PROMPT)
        self.assertIn("北京", SYSTEM_PROMPT)
        self.assertIn("上海", SYSTEM_PROMPT)

    def test_chat_text_accepts_plain_string_gateway_fallback(self):
        self.assertEqual(tools._chat_text('{"title":"测试"}'), '{"title":"测试"}')

    def test_chat_text_drops_usage_only_sse_chunks(self):
        usage_only = (
            'data: {"id":"","object":"chat.completion.chunk","created":0,'
            '"model":"gpt-5.4","choices":[],"usage":{"prompt_tokens":1884}}'
            "\n\n"
            "data: [DONE]"
        )

        self.assertEqual(tools._chat_text(usage_only), "")

    def test_chat_text_extracts_sse_delta_content(self):
        streamed = (
            'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"你好"}}]}'
            "\n\n"
            'data: {"object":"chat.completion.chunk","choices":[{"delta":{"content":"，小红书"}}]}'
            "\n\n"
            "data: [DONE]"
        )

        self.assertEqual(tools._chat_text(streamed), "你好，小红书")


class CopywritingProtocolGuardTests(unittest.IsolatedAsyncioTestCase):
    async def test_generate_article_refuses_to_write_protocol_chunk_as_body(self):
        async def fake_chat_completion(**_kwargs):
            return (
                'data: {"id":"","object":"chat.completion.chunk","created":0,'
                '"model":"gpt-5.4","choices":[],"usage":{"prompt_tokens":1884}}'
                "\n\n"
                "data: [DONE]"
            )

        orig = tools.chat_completion
        try:
            tools.chat_completion = fake_chat_completion
            result = await tools.tool_generate_article({"topic": "威海海景民宿"})
        finally:
            tools.chat_completion = orig

        self.assertFalse(result["ok"])
        self.assertIn("协议 chunk", result["error"])

    async def test_complete_workflow_refuses_to_write_protocol_chunk_as_body(self):
        async def fake_chat_completion(**_kwargs):
            return (
                'data: {"id":"","object":"chat.completion.chunk","created":0,'
                '"model":"gpt-5.4","choices":[],"usage":{"prompt_tokens":1884}}'
                "\n\n"
                "data: [DONE]"
            )

        orig = tools.chat_completion
        try:
            tools.chat_completion = fake_chat_completion
            result = await tools.tool_create_complete_note_workflow({"topic": "威海海景民宿"})
        finally:
            tools.chat_completion = orig

        self.assertFalse(result["ok"])
        self.assertIn("协议 chunk", result["error"])


if __name__ == "__main__":
    unittest.main()
