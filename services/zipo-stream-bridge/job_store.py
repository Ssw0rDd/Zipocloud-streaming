from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any


class JobStore:
    """Bounded, thread-safe SQLite repository for bridge job recovery."""

    def __init__(self, database_path: str, max_records: int = 2_000) -> None:
        self.path = Path(database_path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.max_records = max_records
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(self.path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        with self._lock:
            self._connection.execute("PRAGMA journal_mode=WAL")
            self._connection.execute("PRAGMA synchronous=FULL")
            self._connection.execute("PRAGMA trusted_schema=OFF")
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS bridge_jobs (
                    id TEXT PRIMARY KEY,
                    content_type TEXT NOT NULL,
                    content_id TEXT NOT NULL,
                    season INTEGER,
                    episode INTEGER,
                    qualities TEXT NOT NULL,
                    status TEXT NOT NULL,
                    progress INTEGER NOT NULL,
                    output_prefix TEXT,
                    master_url TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            self._connection.execute(
                "CREATE INDEX IF NOT EXISTS bridge_jobs_updated_idx ON bridge_jobs(updated_at)"
            )
            self._connection.commit()

    def save(self, record: dict[str, Any]) -> None:
        qualities = json.dumps(record["qualities"], separators=(",", ":"))
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO bridge_jobs (
                    id, content_type, content_id, season, episode, qualities,
                    status, progress, output_prefix, master_url, error,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    progress = excluded.progress,
                    output_prefix = excluded.output_prefix,
                    master_url = excluded.master_url,
                    error = excluded.error,
                    updated_at = excluded.updated_at
                """,
                (
                    record["id"],
                    record["content_type"],
                    record["content_id"],
                    record.get("season"),
                    record.get("episode"),
                    qualities,
                    record["status"],
                    record["progress"],
                    record.get("output_prefix"),
                    record.get("master_url"),
                    record.get("error"),
                    record["created_at"],
                    record["updated_at"],
                ),
            )
            self._connection.commit()
            self._prune_overflow_locked()

    def load_recent(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM bridge_jobs ORDER BY updated_at DESC LIMIT ?",
                (self.max_records,),
            ).fetchall()
        return [self._decode(row) for row in rows]

    def mark_interrupted(self, now: float | None = None) -> int:
        timestamp = now if now is not None else time.time()
        with self._lock:
            cursor = self._connection.execute(
                """
                UPDATE bridge_jobs
                SET status = 'failed', progress = 0,
                    error = 'media preparation interrupted by restart', updated_at = ?
                WHERE status IN ('queued', 'extracting', 'processing')
                """,
                (timestamp,),
            )
            self._connection.commit()
            return cursor.rowcount

    def delete_older_than(self, cutoff: float) -> int:
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM bridge_jobs WHERE updated_at < ?",
                (cutoff,),
            )
            self._connection.commit()
            return cursor.rowcount

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    def _prune_overflow_locked(self) -> None:
        self._connection.execute(
            """
            DELETE FROM bridge_jobs
            WHERE id IN (
                SELECT id FROM bridge_jobs
                ORDER BY updated_at DESC
                LIMIT -1 OFFSET ?
            )
            """,
            (self.max_records,),
        )
        self._connection.commit()

    @staticmethod
    def _decode(row: sqlite3.Row) -> dict[str, Any]:
        record = dict(row)
        qualities = json.loads(record["qualities"])
        if not isinstance(qualities, list) or not all(isinstance(value, int) for value in qualities):
            raise ValueError("Corrupt bridge job quality data")
        record["qualities"] = qualities
        return record
