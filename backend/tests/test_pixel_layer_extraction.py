import shutil
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from app.api.routes import api_extract_pixel_layers
from app.config import get_settings
from app.database import User
from app.schemas import ExtractPixelLayersRequest
from app.services.llm import _resolve_local_path


class PixelLayerExtractionTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.image_dir = Path(get_settings().image_dir)
        self.image_dir.mkdir(parents=True, exist_ok=True)
        self.user_id = 9911
        self.sample = self.image_dir / "codex_pixel_layer_unit_test.png"
        im = Image.new("RGBA", (420, 560), "#f8efe6ff")
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((45, 70, 375, 150), radius=22, fill="#ff2442ff")
        d.rectangle((90, 230, 330, 390), fill="#74b9ffff")
        d.ellipse((250, 360, 360, 470), fill="#ffd166ff")
        d.text((82, 92), "XHS TEST", fill="white")
        im.save(self.sample)

    async def asyncTearDown(self):
        self.sample.unlink(missing_ok=True)
        shutil.rmtree(self.image_dir / f"user_{self.user_id}", ignore_errors=True)

    async def test_extracts_real_png_layers_and_clean_background(self):
        user = User(id=self.user_id, username="pixel-test", hashed_password="x", role="admin")
        result = await api_extract_pixel_layers(
            ExtractPixelLayersRequest(
                image_url=f"/static/images/{self.sample.name}",
                sensitivity=0.55,
                max_layers=12,
            ),
            user=user,
        )

        self.assertTrue(result["ok"], result)
        self.assertTrue(result["background_image"].startswith(f"/static/images/user_{self.user_id}/"))
        self.assertGreaterEqual(len(result["layers"]), 1)
        self.assertEqual(result["canvas"], {"width": 420, "height": 560})

        background_path = _resolve_local_path(result["background_image"])
        self.assertTrue(background_path.exists())
        for layer in result["layers"]:
            self.assertTrue(layer["pixel_url"].startswith(f"/static/images/user_{self.user_id}/"))
            self.assertTrue(_resolve_local_path(layer["pixel_url"]).exists())
            self.assertGreater(layer["w"], 0)
            self.assertGreater(layer["h"], 0)
