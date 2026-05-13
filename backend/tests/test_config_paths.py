import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import BASE_DIR, DATA_DIR, Settings, _normalize_runtime_paths, _resolve_data_dir


class ConfigPathTests(unittest.TestCase):
    def test_legacy_default_sqlite_and_image_paths_use_data_dir(self):
        settings = Settings(
            database_url="sqlite+aiosqlite:///./data/xhs_agent.db",
            image_dir="./data/images",
        )

        _normalize_runtime_paths(settings)

        self.assertEqual(
            settings.database_url,
            "sqlite+aiosqlite:///" + str((DATA_DIR / "xhs_agent.db").resolve()),
        )
        self.assertEqual(Path(settings.image_dir), (DATA_DIR / "images").resolve())

    def test_custom_relative_sqlite_and_image_paths_are_backend_anchored(self):
        settings = Settings(
            database_url="sqlite+aiosqlite:///./runtime/custom.db",
            image_dir="./runtime/images",
        )

        _normalize_runtime_paths(settings)

        self.assertEqual(
            settings.database_url,
            "sqlite+aiosqlite:///" + str((BASE_DIR / "runtime/custom.db").resolve()),
        )
        self.assertEqual(Path(settings.image_dir), (BASE_DIR / "runtime/images").resolve())

    def test_legacy_defaults_follow_configured_data_dir(self):
        persistent = Path("/tmp/xhs-agent-persistent")
        settings = Settings(
            database_url="sqlite+aiosqlite:///./data/xhs_agent.db",
            image_dir="./data/images",
        )

        with patch("app.config.DATA_DIR", persistent):
            _normalize_runtime_paths(settings)

        self.assertEqual(
            settings.database_url,
            "sqlite+aiosqlite:///" + str((persistent / "xhs_agent.db").resolve()),
        )
        self.assertEqual(Path(settings.image_dir), (persistent / "images").resolve())

    def test_absolute_sqlite_path_is_preserved(self):
        settings = Settings(
            database_url="sqlite+aiosqlite:////tmp/xhs-agent.db",
            image_dir="/tmp/xhs-images",
        )

        _normalize_runtime_paths(settings)

        self.assertEqual(settings.database_url, "sqlite+aiosqlite:////tmp/xhs-agent.db")
        self.assertEqual(settings.image_dir, "/tmp/xhs-images")

    def test_resolve_data_dir_expands_user_and_relative_paths(self):
        self.assertEqual(_resolve_data_dir("./persist"), (BASE_DIR / "persist").resolve())
        self.assertTrue(str(_resolve_data_dir("~/xhs-agent-data")).endswith("xhs-agent-data"))


if __name__ == "__main__":
    unittest.main()
