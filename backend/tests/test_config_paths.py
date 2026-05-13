import unittest
from pathlib import Path

from app.config import BASE_DIR, Settings, _normalize_runtime_paths


class ConfigPathTests(unittest.TestCase):
    def test_relative_sqlite_and_image_paths_are_backend_anchored(self):
        settings = Settings(
            database_url="sqlite+aiosqlite:///./data/xhs_agent.db",
            image_dir="./data/images",
        )

        _normalize_runtime_paths(settings)

        self.assertEqual(
            settings.database_url,
            "sqlite+aiosqlite:///" + str((BASE_DIR / "data/xhs_agent.db").resolve()),
        )
        self.assertEqual(Path(settings.image_dir), (BASE_DIR / "data/images").resolve())

    def test_absolute_sqlite_path_is_preserved(self):
        settings = Settings(
            database_url="sqlite+aiosqlite:////tmp/xhs-agent.db",
            image_dir="/tmp/xhs-images",
        )

        _normalize_runtime_paths(settings)

        self.assertEqual(settings.database_url, "sqlite+aiosqlite:////tmp/xhs-agent.db")
        self.assertEqual(settings.image_dir, "/tmp/xhs-images")


if __name__ == "__main__":
    unittest.main()
