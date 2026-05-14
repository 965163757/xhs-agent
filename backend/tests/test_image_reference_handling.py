import base64
import tempfile
import unittest
from pathlib import Path

from app.agents.tools import _image_retry_options
from app.config import Settings
from app.services import llm


TINY_IMAGE_BYTES = b"\x89PNG\r\n\x1a\n"
TINY_IMAGE_B64 = base64.b64encode(TINY_IMAGE_BYTES).decode("ascii")


class _FakeImages:
    def __init__(self) -> None:
        self.last_edit_kwargs = None

    async def edit(self, **kwargs):
        self.last_edit_kwargs = kwargs
        return type("Resp", (), {"data": [{"b64_json": TINY_IMAGE_B64}]})()


class _FakeClient:
    def __init__(self) -> None:
        self.images = _FakeImages()


class _QualityRejectingImages:
    def __init__(self) -> None:
        self.calls = []

    async def edit(self, **kwargs):
        self.calls.append(kwargs)
        if "quality" in kwargs:
            raise TypeError("AsyncImages.edit() got an unexpected keyword argument 'quality'")
        return type("Resp", (), {"data": [{"b64_json": TINY_IMAGE_B64}]})()


class _QualityRejectingClient:
    def __init__(self) -> None:
        self.images = _QualityRejectingImages()


class _EmptyEditImages:
    async def edit(self, **_kwargs):
        return type(
            "Resp",
            (),
            {
                "data": None,
                "model_dump": lambda self: {
                    "created": None,
                    "data": None,
                    "error": {
                        "message": "upstream did not return any image output",
                        "type": "upstream_error",
                    },
                },
            },
        )()


class _EmptyEditClient:
    def __init__(self) -> None:
        self.images = _EmptyEditImages()

class _FailIfCalledImages:
    async def edit(self, **_kwargs):
        raise AssertionError("SDK should have been skipped")


class _FailIfCalledClient:
    def __init__(self) -> None:
        self.images = _FailIfCalledImages()


class ImageReferenceHandlingTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_app_static_url_uploads_file_when_url_capability_disabled(self):
        with tempfile.TemporaryDirectory() as image_dir:
            ref_path = Path(image_dir) / "ref.png"
            ref_path.write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                public_base_url="https://xhs.example.com/app",
                image_api_key="test-key",
                image_base_url="https://image-gateway.invalid/v1",
                image_supports_image_url=False,
            )
            own_public_url = "https://xhs.example.com/app/static/images/ref.png"

            self.assertEqual(llm._local_static_path_part(own_public_url, settings), "/static/images/ref.png")
            self.assertEqual(llm._public_url_for_local_image("/static/images/ref.png", settings), own_public_url)
            self.assertEqual(llm._provider_image_url(own_public_url, settings), own_public_url)

            async def fail_url_native(**_kwargs):
                raise AssertionError("URL-native edit should be skipped when supports_image_url=false")

            async def raw_multipart_success(**_kwargs):
                return ["/static/images/edited.png"]

            orig_get_settings = llm.get_settings
            orig_url_native = llm._edit_image_url_raw_http
            orig_get_client = llm.get_client
            orig_multipart = llm._edit_image_multipart_raw_http
            try:
                llm.get_settings = lambda: settings
                llm._edit_image_url_raw_http = fail_url_native
                llm._edit_image_multipart_raw_http = raw_multipart_success
                llm.get_client = lambda _settings=None, kind="chat": _FailIfCalledClient()

                saved = await llm.edit_image(
                    image_url=own_public_url,
                    mask_url=None,
                    prompt="保持风格，生成新版海报",
                    size="1024x1024",
                    n=1,
                    quality="high",
                    settings=settings,
                )
            finally:
                llm.get_settings = orig_get_settings
                llm._edit_image_url_raw_http = orig_url_native
                llm.get_client = orig_get_client
                llm._edit_image_multipart_raw_http = orig_multipart

            self.assertEqual(saved, ["/static/images/edited.png"])

    async def test_sdk_edit_retries_without_quality_when_sdk_does_not_support_it(self):
        with tempfile.TemporaryDirectory() as image_dir:
            ref_path = Path(image_dir) / "ref.png"
            ref_path.write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://api.openai.com/v1",
            )
            fake_client = _QualityRejectingClient()
            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": fake_client
                saved = await llm.edit_image(
                    image_url="/static/images/ref.png",
                    mask_url=None,
                    prompt="整体风格化",
                    size="1024x1024",
                    n=1,
                    quality="high",
                    settings=settings,
                )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client

            self.assertEqual(len(saved), 1)
            self.assertEqual(len(fake_client.images.calls), 2)
            self.assertIn("quality", fake_client.images.calls[0])
            self.assertNotIn("quality", fake_client.images.calls[1])

    async def test_sdk_mask_edit_retries_without_quality_when_sdk_does_not_support_it(self):
        with tempfile.TemporaryDirectory() as image_dir:
            (Path(image_dir) / "ref.png").write_bytes(TINY_IMAGE_BYTES)
            (Path(image_dir) / "mask.png").write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://api.openai.com/v1",
            )
            fake_client = _QualityRejectingClient()
            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": fake_client
                saved = await llm.edit_image(
                    image_url="/static/images/ref.png",
                    mask_url="/static/images/mask.png",
                    prompt="局部重绘",
                    size="1024x1024",
                    n=1,
                    quality="high",
                    settings=settings,
                )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client

            self.assertEqual(len(saved), 1)
            self.assertEqual(len(fake_client.images.calls), 2)
            self.assertIn("mask", fake_client.images.calls[1])
            self.assertNotIn("quality", fake_client.images.calls[1])

    async def test_sdk_edit_empty_data_fast_fails_current_model_without_raw_fallback(self):
        with tempfile.TemporaryDirectory() as image_dir:
            (Path(image_dir) / "ref.png").write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://api.openai.com/v1",
                public_base_url="",
            )

            async def raw_multipart_should_not_run(**_kwargs):
                raise AssertionError("raw multipart should be skipped in fast-failover mode")

            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            orig_multipart = llm._edit_image_multipart_raw_http
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": _EmptyEditClient()
                llm._edit_image_multipart_raw_http = raw_multipart_should_not_run
                with self.assertRaisesRegex(RuntimeError, "upstream did not return any image output"):
                    await llm.edit_image(
                        image_url="/static/images/ref.png",
                        mask_url=None,
                        prompt="整体风格化",
                        size="1024x1024",
                        n=1,
                        quality="high",
                        settings=settings,
                    )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client
                llm._edit_image_multipart_raw_http = orig_multipart

    async def test_sdk_edit_empty_data_reports_gateway_error_instead_of_typeerror(self):
        with tempfile.TemporaryDirectory() as image_dir:
            (Path(image_dir) / "ref.png").write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://api.openai.com/v1",
                public_base_url="",
            )

            async def fail_multipart(**_kwargs):
                raise RuntimeError("multipart rejected")

            async def fail_data_url(**_kwargs):
                raise RuntimeError("data-url rejected")

            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            orig_multipart = llm._edit_image_multipart_raw_http
            orig_url_native = llm._edit_image_url_raw_http
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": _EmptyEditClient()
                llm._edit_image_multipart_raw_http = fail_multipart
                llm._edit_image_url_raw_http = fail_data_url
                with self.assertRaisesRegex(RuntimeError, "upstream did not return any image output"):
                    await llm.edit_image(
                        image_url="/static/images/ref.png",
                        mask_url=None,
                        prompt="整体风格化",
                        size="1024x1024",
                        n=1,
                        quality="high",
                        settings=settings,
                    )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client
                llm._edit_image_multipart_raw_http = orig_multipart
                llm._edit_image_url_raw_http = orig_url_native

    def test_extract_image_items_supports_gateway_image_string_wrappers(self):
        items = llm._extract_image_items({"output": [{"image": f"data:image/png;base64,{TINY_IMAGE_B64}"}]})
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]["b64_json"].startswith("data:image/png;base64,"))

    async def test_app_static_image_uses_multipart_when_url_capability_disabled_on_custom_gateway(self):
        with tempfile.TemporaryDirectory() as image_dir:
            (Path(image_dir) / "ref.png").write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://image-gateway.invalid/v1",
                public_base_url="https://xhs.example.com/app",
                image_supports_image_url=False,
            )
            seen = {}

            async def fail_if_url_native_called(**_kwargs):
                raise AssertionError("URL-native edit should be skipped when supports_image_url=false")

            async def raw_multipart_success(**kwargs):
                seen["timeout"] = kwargs.get("timeout")
                return ["/static/images/edited.png"]

            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            orig_multipart = llm._edit_image_multipart_raw_http
            orig_url_native = llm._edit_image_url_raw_http
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": _FailIfCalledClient()
                llm._edit_image_multipart_raw_http = raw_multipart_success
                llm._edit_image_url_raw_http = fail_if_url_native_called
                saved = await llm.edit_image(
                    image_url="/static/images/ref.png",
                    mask_url=None,
                    prompt="整体风格化",
                    size="1024x1024",
                    n=1,
                    quality="high",
                    settings=settings,
                )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client
                llm._edit_image_multipart_raw_http = orig_multipart
                llm._edit_image_url_raw_http = orig_url_native

            self.assertEqual(saved, ["/static/images/edited.png"])
            self.assertEqual(seen.get("timeout"), llm.IMAGE_GENERATION_TIMEOUT_SECONDS)

    async def test_image_capability_flags_disable_url_and_quality_for_external_urls(self):
        with tempfile.TemporaryDirectory() as image_dir:
            ref_path = Path(image_dir) / "downloaded.png"
            ref_path.write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://image-gateway.invalid/v1",
                public_base_url="https://xhs.example.com/app",
                image_supports_image_url=False,
                image_supports_quality=False,
            )
            seen = {}

            async def fake_download(url, _settings, *, suffix="remote"):
                seen["download_url"] = url
                return ref_path

            async def fail_if_url_native_called(**_kwargs):
                raise AssertionError("external URL should be downloaded when supports_image_url=false")

            async def raw_multipart_success(**kwargs):
                seen["quality"] = kwargs.get("quality")
                seen["img_path"] = kwargs.get("img_path")
                return ["/static/images/edited.png"]

            orig_download = llm._download_remote_image_to_local
            orig_multipart = llm._edit_image_multipart_raw_http
            orig_url_native = llm._edit_image_url_raw_http
            try:
                llm._download_remote_image_to_local = fake_download
                llm._edit_image_multipart_raw_http = raw_multipart_success
                llm._edit_image_url_raw_http = fail_if_url_native_called
                attempts = []
                saved = await llm.edit_image(
                    image_url="https://cdn.example.com/ref.png",
                    mask_url=None,
                    prompt="整体风格化",
                    size="1024x1024",
                    n=1,
                    quality="high",
                    settings=settings,
                    attempt_trace=attempts,
                )
            finally:
                llm._download_remote_image_to_local = orig_download
                llm._edit_image_multipart_raw_http = orig_multipart
                llm._edit_image_url_raw_http = orig_url_native

            self.assertEqual(saved, ["/static/images/edited.png"])
            self.assertEqual(seen["download_url"], "https://cdn.example.com/ref.png")
            self.assertEqual(seen["quality"], "")
            self.assertEqual(seen["img_path"], ref_path)
            self.assertEqual(attempts[0]["method"], "raw_multipart_edit")
            self.assertFalse(attempts[0]["supports_image_url"])
            self.assertFalse(attempts[0]["supports_quality"])

    async def test_chat_image_context_exposes_stable_path_and_server_public_url(self):
        settings = Settings(public_base_url="https://xhs.example.com/app")
        out = await llm.to_openai_messages(
            [{"role": "user", "content": "参考这张图", "images": ["/static/images/ref.png"]}],
            settings=settings,
        )
        parts = out[0]["content"]
        self.assertEqual(parts[0]["type"], "text")
        self.assertIn("[图片路径: /static/images/ref.png | 可访问URL: https://xhs.example.com/app/static/images/ref.png]", parts[1]["text"])
        self.assertEqual(parts[2]["image_url"]["url"], "https://xhs.example.com/app/static/images/ref.png")

    async def test_custom_gateway_http_rejection_fast_fails_without_slow_sdk_upload(self):
        with tempfile.TemporaryDirectory() as image_dir:
            (Path(image_dir) / "ref.png").write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                image_api_key="test-key",
                image_base_url="https://image-gateway.invalid/v1",
                public_base_url="",
            )

            async def reject_multipart(**_kwargs):
                raise RuntimeError("HTTP 500: gateway rejected multipart")

            async def reject_data_url(**_kwargs):
                raise RuntimeError("HTTP 503: gateway rejected data-url")

            orig_get_settings = llm.get_settings
            orig_get_client = llm.get_client
            orig_multipart = llm._edit_image_multipart_raw_http
            orig_url_native = llm._edit_image_url_raw_http
            try:
                llm.get_settings = lambda: settings
                llm.get_client = lambda _settings=None, kind="chat": _FailIfCalledClient()
                llm._edit_image_multipart_raw_http = reject_multipart
                llm._edit_image_url_raw_http = reject_data_url
                with self.assertRaisesRegex(RuntimeError, "raw multipart"):
                    await llm.edit_image(
                        image_url="/static/images/ref.png",
                        mask_url=None,
                        prompt="整体风格化",
                        size="1024x1024",
                        n=1,
                        quality="high",
                        settings=settings,
                    )
            finally:
                llm.get_settings = orig_get_settings
                llm.get_client = orig_get_client
                llm._edit_image_multipart_raw_http = orig_multipart
                llm._edit_image_url_raw_http = orig_url_native

    async def test_true_external_url_stays_url_only_when_provider_rejects_it(self):
        settings = Settings(
            image_api_key="test-key",
            image_base_url="https://image-gateway.invalid/v1",
            public_base_url="https://xhs.example.com/app",
        )

        async def fail_url_native(**_kwargs):
            raise RuntimeError("provider does not accept image_url")

        orig_url_native = llm._edit_image_url_raw_http
        try:
            llm._edit_image_url_raw_http = fail_url_native
            with self.assertRaisesRegex(RuntimeError, "外部图片 URL"):
                await llm.edit_image(
                    image_url="https://cdn.example.com/ref.png",
                    mask_url=None,
                    prompt="保持风格",
                    settings=settings,
                )
        finally:
            llm._edit_image_url_raw_http = orig_url_native

    def test_retry_options_tolerate_string_n(self):
        options = _image_retry_options("北京旅游攻略", "2048x1152", "high", n="2")
        self.assertGreaterEqual(len(options), 2)
        self.assertEqual(options[0]["arguments"]["n"], 2)


if __name__ == "__main__":
    unittest.main()
