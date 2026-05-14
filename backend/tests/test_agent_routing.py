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

    def test_prompt_requires_clarification_for_ambiguous_intent(self):
        self.assertIn("不要把模糊需求强行兜底到某个工具", SYSTEM_PROMPT)
        self.assertIn("判断不清时先反问", SYSTEM_PROMPT)
        self.assertIn("不等同于真实生图", SYSTEM_PROMPT)

    def test_default_tool_round_limit_is_12(self):
        sig = inspect.signature(run_agent_stream)
        self.assertEqual(sig.parameters["max_tool_rounds"].default, 12)

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
