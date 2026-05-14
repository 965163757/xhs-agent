import inspect
import unittest

import app.agents.runner as runner
from app.agents.runner import SYSTEM_PROMPT, run_agent_stream
from app.agents.tools import TOOLS


class AgentRoutingTests(unittest.TestCase):
    def test_agent_no_longer_has_forced_regex_routing(self):
        """Tool routing should be owned by the model, not deterministic fallback regexes."""

        for name in (
            "_coerce_tool_call_for_intent",
            "_is_image_focused_request",
            "_wants_complete_note",
            "_EXPLICIT_IMAGE_GENERATION_RE",
            "_COMPLETE_NOTE_RE",
            "_VISUAL_PLAN_ONLY_RE",
        ):
            self.assertFalse(hasattr(runner, name), f"{name} should not exist")

    def test_prompt_requires_batched_clarification_for_ambiguous_intent(self):
        self.assertIn("不要把模糊需求强行兜底到某个工具", SYSTEM_PROMPT)
        self.assertIn("反问默认一次性完成", SYSTEM_PROMPT)
        self.assertIn("避免无必要地分多轮逐个追问", SYSTEM_PROMPT)
        self.assertIn("如果只有 1 个真正阻塞点，可以只问 1 个", SYSTEM_PROMPT)
        self.assertIn("不等同于真实生图", SYSTEM_PROMPT)
        self.assertNotIn("先反问 1 个关键问题", SYSTEM_PROMPT)

    def test_default_tool_round_limit_is_12(self):
        sig = inspect.signature(run_agent_stream)
        self.assertEqual(sig.parameters["max_tool_rounds"].default, 12)

    def test_latest_uploaded_image_stays_attached(self):
        out = runner._compact_input_messages(
            [{"role": "user", "content": "把这张图调成更清晰", "images": ["/static/images/new.png"]}],
            keep_recent=10,
        )
        self.assertEqual(out[-1]["images"], ["/static/images/new.png"])

    def test_unreferenced_historical_images_are_path_only_in_local_mode(self):
        out = runner._compact_input_messages(
            [
                {"role": "user", "content": "上传素材", "images": ["/static/images/old.png"]},
                {"role": "assistant", "content": "收到"},
                {"role": "user", "content": "帮我写三个标题", "images": []},
            ],
            keep_recent=10,
            server_public_images=False,
        )
        self.assertEqual(out[0]["images"], [])
        self.assertIn("[历史图片路径: /static/images/old.png]", out[0]["content"])

    def test_server_mode_keeps_more_recent_image_pixels_than_local_mode(self):
        messages = [
            {"role": "user", "content": f"图 {i}", "images": [f"/static/images/{i}.png"]}
            for i in range(5)
        ] + [{"role": "user", "content": "继续改刚才那张图", "images": []}]

        local = runner._compact_input_messages(messages, keep_recent=10, server_public_images=False)
        server = runner._compact_input_messages(messages, keep_recent=10, server_public_images=True)

        local_attached = sum(1 for item in local if item.get("images"))
        server_attached = sum(1 for item in server if item.get("images"))
        self.assertEqual(local_attached, 2)
        self.assertEqual(server_attached, 4)

    def test_visual_tool_schema_uses_single_queue_semantics(self):
        workflow_schema = TOOLS["create_complete_note_workflow"]["schema"]["function"]
        workflow_props = workflow_schema["parameters"]["properties"]
        self.assertIn("展示队列第 1 张", workflow_props["generate_cover"]["description"])
        self.assertIn("第一张生成图会成为首图", workflow_props["generate_content_images"]["description"])

        image_schema = TOOLS["generate_article_images"]["schema"]["function"]
        self.assertIn("展示队列图片", image_schema["description"])
        self.assertIn("队列第 1 张", image_schema["parameters"]["properties"]["include_cover"]["description"])


if __name__ == "__main__":
    unittest.main()
