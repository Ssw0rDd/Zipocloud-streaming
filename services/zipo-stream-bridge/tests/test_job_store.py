from __future__ import annotations

from pathlib import Path

from job_store import JobStore


def record(job_id: str, status: str = "queued", updated_at: float = 10.0):
    return {
        "id": job_id,
        "content_type": "movie",
        "content_id": "tt1234567",
        "season": None,
        "episode": None,
        "qualities": [480, 720],
        "status": status,
        "progress": 0,
        "output_prefix": None,
        "master_url": None,
        "error": None,
        "created_at": 1.0,
        "updated_at": updated_at,
    }


def test_persists_and_recovers_interrupted_jobs(tmp_path: Path):
    path = tmp_path / "jobs.sqlite3"
    store = JobStore(str(path), max_records=100)
    store.save(record("job-1"))
    assert store.mark_interrupted(now=20.0) == 1
    store.close()

    reopened = JobStore(str(path), max_records=100)
    [value] = reopened.load_recent()
    assert value["status"] == "failed"
    assert value["error"] == "media preparation interrupted by restart"
    reopened.close()


def test_bounds_records_and_removes_expired_rows(tmp_path: Path):
    store = JobStore(str(tmp_path / "jobs.sqlite3"), max_records=100)
    for index in range(105):
        store.save(record(f"job-{index}", status="ready", updated_at=float(index)))
    assert len(store.load_recent()) == 100
    assert store.delete_older_than(100.0) == 95
    assert len(store.load_recent()) == 5
    store.close()
