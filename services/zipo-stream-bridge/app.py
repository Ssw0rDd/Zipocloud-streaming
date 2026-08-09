from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from config import settings
from converter import convert_to_hls
from extractor import ExtractError, extract_stream
from job_store import JobStore
from storage import upload_directory

logging.basicConfig(level=getattr(logging, settings.log_level.upper(), logging.INFO))
LOGGER = logging.getLogger("zipo-stream-bridge")

ContentType = Literal["movie", "series", "anime"]


class JobStatus(str, Enum):
    queued = "queued"
    extracting = "extracting"
    processing = "processing"
    ready = "ready"
    failed = "failed"


@dataclass
class Job:
    id: str
    content_type: ContentType
    content_id: str
    season: int | None
    episode: int | None
    qualities: list[int]
    status: JobStatus = JobStatus.queued
    progress: int = 0
    output_prefix: str | None = None
    master_url: str | None = None
    error: str | None = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class PrepareRequest(BaseModel):
    contentType: ContentType
    contentId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    season: int | None = Field(default=None, ge=1, le=10_000)
    episode: int | None = Field(default=None, ge=1, le=100_000)
    qualities: list[Literal[480, 720, 1080]] = Field(
        default_factory=lambda: [480, 720, 1080],
        min_length=1,
        max_length=3,
    )


class PrepareResponse(BaseModel):
    jobId: str
    status: JobStatus
    progress: int
    outputPrefix: str | None = None
    masterUrl: str | None = None
    error: str | None = None


jobs: dict[str, Job] = {}
jobs_lock = threading.Lock()
job_store = JobStore(settings.job_database_path, settings.max_job_records)
job_executor = ThreadPoolExecutor(
    max_workers=settings.worker_threads,
    thread_name_prefix="zipo-bridge",
)


def _job_record(job: Job) -> dict[str, object]:
    return {
        "id": job.id,
        "content_type": job.content_type,
        "content_id": job.content_id,
        "season": job.season,
        "episode": job.episode,
        "qualities": job.qualities,
        "status": job.status.value,
        "progress": job.progress,
        "output_prefix": job.output_prefix,
        "master_url": job.master_url,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _record_job(record: dict[str, object]) -> Job:
    return Job(
        id=str(record["id"]),
        content_type=str(record["content_type"]),  # type: ignore[arg-type]
        content_id=str(record["content_id"]),
        season=record.get("season") if isinstance(record.get("season"), int) else None,
        episode=record.get("episode") if isinstance(record.get("episode"), int) else None,
        qualities=[int(value) for value in record["qualities"]],  # type: ignore[union-attr]
        status=JobStatus(str(record["status"])),
        progress=int(record["progress"]),
        output_prefix=str(record["output_prefix"]) if record.get("output_prefix") else None,
        master_url=str(record["master_url"]) if record.get("master_url") else None,
        error=str(record["error"]) if record.get("error") else None,
        created_at=float(record["created_at"]),
        updated_at=float(record["updated_at"]),
    )


interrupted_jobs = job_store.mark_interrupted()
for stored_record in job_store.load_recent():
    restored = _record_job(stored_record)
    jobs[restored.id] = restored
if interrupted_jobs:
    LOGGER.warning("Marked %d interrupted bridge job(s) as failed", interrupted_jobs)

app = FastAPI(title="ZiPo Stream Bridge", version="1.0.0")


def verify_secret(x_zipo_bridge_secret: str | None = Header(default=None)) -> None:
    expected = settings.secret
    if not expected or len(expected) < 32:
        raise HTTPException(status_code=503, detail="Bridge secret is not configured")
    if not x_zipo_bridge_secret or not secrets.compare_digest(x_zipo_bridge_secret, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _job_response(job: Job) -> PrepareResponse:
    return PrepareResponse(
        jobId=job.id,
        status=job.status,
        progress=job.progress,
        outputPrefix=job.output_prefix,
        masterUrl=job.master_url,
        error=job.error,
    )


def _update(job: Job, **changes) -> None:
    with jobs_lock:
        for key, value in changes.items():
            setattr(job, key, value)
        job.updated_at = time.time()
        job_store.save(_job_record(job))


def _run_job(job_id: str) -> None:
    asyncio.run(_process_job(job_id))


async def _process_job(job_id: str) -> None:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        return

    work_dir = Path(tempfile.mkdtemp(prefix=f"zipo-bridge-{job_id}-"))
    try:
        _update(job, status=JobStatus.extracting, progress=5)
        extracted = await extract_stream(
            content_type=job.content_type,
            content_id=job.content_id,
            season=job.season,
            episode=job.episode,
        )
        _update(job, status=JobStatus.processing, progress=15)

        def on_progress(value: int) -> None:
            _update(job, progress=value)

        await convert_to_hls(
            extracted.stream_url,
            work_dir,
            qualities=job.qualities,
            progress_callback=on_progress,
        )
        output_prefix = f"playback-cache/cinema/{job_id}/"
        upload_directory(work_dir, output_prefix)
        master_url = f"{output_prefix}master.m3u8"
        _update(
            job,
            status=JobStatus.ready,
            progress=100,
            output_prefix=output_prefix,
            master_url=master_url,
        )
        LOGGER.info("Job %s ready at %s", job_id, master_url)
    except ExtractError as error:
        LOGGER.error("Job %s extract failed (%s)", job_id, type(error).__name__)
        _update(job, status=JobStatus.failed, progress=0, error="media extraction failed")
    except Exception as error:  # noqa: BLE001
        LOGGER.error("Job %s failed (%s)", job_id, type(error).__name__)
        _update(job, status=JobStatus.failed, progress=0, error="media preparation failed")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/prepare", dependencies=[Depends(verify_secret)])
async def prepare(body: PrepareRequest) -> PrepareResponse:
    cutoff = time.time() - settings.job_ttl_seconds
    job_store.delete_older_than(cutoff)
    with jobs_lock:
        expired_ids = [job_id for job_id, value in jobs.items() if value.updated_at < cutoff]
        for expired_id in expired_ids:
            jobs.pop(expired_id, None)
        active_count = sum(
            value.status in {JobStatus.queued, JobStatus.extracting, JobStatus.processing}
            for value in jobs.values()
        )
    if active_count >= settings.max_active_jobs:
        raise HTTPException(status_code=429, detail="Bridge queue is full", headers={"Retry-After": "30"})

    job_id = secrets.token_urlsafe(18)[:24]
    job = Job(
        id=job_id,
        content_type=body.contentType,
        content_id=body.contentId,
        season=body.season,
        episode=body.episode,
        qualities=body.qualities,
    )
    with jobs_lock:
        jobs[job_id] = job
        job_store.save(_job_record(job))
    job_executor.submit(_run_job, job_id)
    return _job_response(job)


@app.get("/v1/prepare/{job_id}", dependencies=[Depends(verify_secret)])
async def prepare_status(job_id: str) -> PrepareResponse:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_response(job)


def main() -> None:
    import uvicorn

    uvicorn.run(
        "app:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
