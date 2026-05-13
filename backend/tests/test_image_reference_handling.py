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


class ImageReferenceHandlingTests(unittest.IsolatedAsyncioTestCase):
    async def test_public_app_static_url_can_fallback_to_local_upload(self):
        with tempfile.TemporaryDirectory() as image_dir:
            ref_path = Path(image_dir) / "ref.png"
            ref_path.write_bytes(TINY_IMAGE_BYTES)
            settings = Settings(
                image_dir=image_dir,
                public_base_url="https://xhs.example.com/app",
                image_api_key="test-key",
                image_base_url="https://image-gateway.invalid/v1",
            )
            own_public_url = "https://xhs.example.com/app/static/images/ref.png"

            self.assertEqual(llm._local_static_path_part(own_public_url, settings), "/static/images/ref.png")
            self.assertEqual(llm._public_url_for_local_image("/static/images/ref.png", settings), own_public_url)
            self.assertEqual(llm._provider_image_url(own_public_url, settings), own_public_url)

            async def fail_url_native(**_kwargs):
                raise RuntimeError("provider does not accept image_url")

            fake_client = _FakeClient()
            orig_get_settings = llm.get_settings
            orig_url_native = llm._edit_image_url_raw_http
            orig_get_client = llm.get_client
            try:
                llm.get_settings = lambda: settings
                llm._edit_image_url_raw_http = fail_url_native
                llm.get_client = lambda _settings=None, kind="chat": fake_client

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

            self.assertEqual(len(saved), 1)
            self.assertTrue(saved[0].startswith("/static/images/"))
            self.assertIsNotNone(fake_client.images.last_edit_kwargs)
            uploaded = fake_client.images.last_edit_kwargs["image"]
            self.assertEqual(uploaded[0], "ref.png")
            self.assertEqual(uploaded[2], "image/png")

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
