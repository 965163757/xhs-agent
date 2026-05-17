import json

from app.api.routes import (
    MAX_CHAT_IMAGES_PER_MESSAGE,
    MAX_CHAT_MESSAGE_CHARS,
    MAX_CHAT_REQUEST_MESSAGES,
    MAX_STORED_CONVERSATION_MESSAGES,
    _build_agent_article_context_message,
    _mcp_http_response,
    _sanitize_conversation_messages,
    _sanitize_runtime_messages,
)
from app.database import Article


def test_runtime_sanitizer_preserves_current_article_context_and_bounds_history():
    context = {
        "role": "user",
        "content": "【当前笔记上下文 · id=9】\n标题：测试",
        "images": [f"/static/images/context_{i}.png" for i in range(20)],
    }
    messages = [context] + [
        {"role": "user", "content": "x" * (MAX_CHAT_MESSAGE_CHARS + 100), "images": [f"/static/images/{i}_{j}.png" for j in range(12)]}
        for i in range(MAX_CHAT_REQUEST_MESSAGES + 20)
    ]

    out = _sanitize_runtime_messages(messages)

    assert out[0]["content"].startswith("【当前笔记上下文")
    assert len(out) == MAX_CHAT_REQUEST_MESSAGES + 1
    assert len(out[-1]["content"]) == MAX_CHAT_MESSAGE_CHARS
    assert len(out[-1]["images"]) == MAX_CHAT_IMAGES_PER_MESSAGE


def test_backend_article_context_builder_includes_image_queue_and_attaches_when_visual_intent():
    article = Article(
        id=7,
        title="测试笔记",
        body="这是一篇测试正文",
        tags="杭州,西湖",
        cover_image="/static/images/cover.png",
        images=["/static/images/detail.png"],
        status="draft",
    )

    msg = _build_agent_article_context_message(article, "看看这篇的图片队列是否正常")

    assert msg["content"].startswith("【当前笔记上下文 · id=7】")
    assert "首图/封面" in msg["content"]
    assert "第 2 张" in msg["content"]
    assert msg["images"][:2] == ["/static/images/cover.png", "/static/images/detail.png"]


def test_mcp_http_response_surfaces_nested_tool_failure():
    response = _mcp_http_response({"ok": False, "error": "bad args"})

    assert response["ok"] is False
    assert response["error"] == "bad args"
    assert response["result"]["ok"] is False


def test_conversation_sanitizer_limits_messages_and_compacts_tool_results():
    huge_error = "上游错误" + "E" * 20_000
    messages = [
        {
            "role": "assistant",
            "content": f"assistant {i}",
            "tool_events": [
                {
                    "type": "tool_result",
                    "name": "generate_image",
                    "result": {
                        "ok": False,
                        "error": huge_error,
                        "raw_error": "RAW" * 10_000,
                        "image_attempts": [{"model": "m", "error": huge_error} for _ in range(20)],
                    },
                }
            ],
        }
        for i in range(MAX_STORED_CONVERSATION_MESSAGES + 10)
    ]

    out = _sanitize_conversation_messages(messages)

    assert len(out) == MAX_STORED_CONVERSATION_MESSAGES
    result = out[-1]["tool_events"][0]["result"]
    encoded = json.dumps(result, ensure_ascii=False)
    assert "raw_error" not in encoded
    assert len(result.get("image_attempts", [])) <= 8
    assert len(encoded) < 12_000
