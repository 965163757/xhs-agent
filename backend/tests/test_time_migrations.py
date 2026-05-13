import asyncio
import unittest
from datetime import datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database import _repair_future_beijing_timestamps
from app.time_utils import beijing_now_naive


class TimeMigrationTests(unittest.TestCase):
    def test_future_double_shifted_conversation_time_is_repaired(self):
        async def run():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.execute(
                    text("CREATE TABLE conversations(created_at TEXT, updated_at TEXT)")
                )
                future = (beijing_now_naive() + timedelta(hours=8)).strftime(
                    "%Y-%m-%d %H:%M:%S"
                )
                await conn.execute(
                    text(
                        "INSERT INTO conversations(created_at, updated_at) "
                        "VALUES (:created_at, :updated_at)"
                    ),
                    {"created_at": future, "updated_at": future},
                )

                await _repair_future_beijing_timestamps(conn)

                row = (
                    await conn.execute(
                        text("SELECT created_at, updated_at FROM conversations")
                    )
                ).fetchone()
            await engine.dispose()
            return row

        row = asyncio.run(run())
        self.assertIsNotNone(row)
        threshold = beijing_now_naive() + timedelta(minutes=10)
        self.assertLessEqual(datetime.fromisoformat(row[0]), threshold)
        self.assertLessEqual(datetime.fromisoformat(row[1]), threshold)


if __name__ == "__main__":
    unittest.main()
