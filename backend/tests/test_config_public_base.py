import unittest

from app.config import Settings, infer_public_base_url, with_public_base_url_if_missing


class PublicBaseInferenceTests(unittest.TestCase):
    def test_rejects_local_and_private_hosts(self):
        self.assertEqual(infer_public_base_url("http://127.0.0.1:8787/"), "")
        self.assertEqual(infer_public_base_url("http://localhost:8787/"), "")
        self.assertEqual(infer_public_base_url("http://192.168.1.2:8787/"), "")

    def test_accepts_public_domain_and_keeps_existing_setting(self):
        inferred = infer_public_base_url("https://xhs.example.com/app/")
        self.assertEqual(inferred, "https://xhs.example.com/app")

        base = Settings(public_base_url="https://configured.example.com")
        self.assertIs(with_public_base_url_if_missing(base, "https://xhs.example.com/app/"), base)

        missing = Settings(public_base_url="")
        copied = with_public_base_url_if_missing(missing, "https://xhs.example.com/app/")
        self.assertEqual(copied.public_base_url, "https://xhs.example.com/app")
        self.assertEqual(missing.public_base_url, "")


if __name__ == "__main__":
    unittest.main()
