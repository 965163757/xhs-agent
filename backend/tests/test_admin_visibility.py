import unittest

from app.api.routes import _can_access_owned_record, _with_owner_meta
from app.database import User


class AdminVisibilityTests(unittest.TestCase):
    def test_admin_can_access_any_owned_record(self):
        admin = User(id=1, username="admin", role="admin", hashed_password="x")
        self.assertTrue(_can_access_owned_record(admin, 2))
        self.assertTrue(_can_access_owned_record(admin, None))

    def test_normal_user_can_only_access_own_record(self):
        user = User(id=2, username="alice", role="user", hashed_password="x")
        self.assertTrue(_can_access_owned_record(user, 2))
        self.assertFalse(_can_access_owned_record(user, 3))

    def test_owner_metadata_marks_user(self):
        payload = _with_owner_meta({"id": 10, "title": "x"}, 2, {2: {"id": 2, "username": "alice", "role": "user"}})
        self.assertEqual(payload["user_id"], 2)
        self.assertEqual(payload["owner_user"]["username"], "alice")


if __name__ == "__main__":
    unittest.main()
