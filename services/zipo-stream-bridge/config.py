from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_ENV = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ROOT_ENV)


def _flag(key: str, default: bool = False) -> bool:
    value = os.getenv(key)
    if value is None or value == "":
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def _list(key: str) -> tuple[str, ...]:
    return tuple(
        entry.strip().lower()
        for entry in os.getenv(key, "").split(",")
        if entry.strip()
    )


@dataclass(frozen=True)
class Settings:
    host: str = os.getenv("STREAM_BRIDGE_HOST", "0.0.0.0")
    port: int = int(os.getenv("STREAM_BRIDGE_PORT", "8090"))
    secret: str = os.getenv("STREAM_BRIDGE_SECRET", "")
    log_level: str = os.getenv("LOG_LEVEL", "info")
    internal_api_url: str = os.getenv("INTERNAL_API_URL", os.getenv("API_URL", "http://localhost:3001"))
    superflix_enabled: bool = _flag("SUPERFLIX_ENABLED", False)
    superflix_base_url: str = os.getenv("SUPERFLIX_BASE_URL", "https://superflixapi.pro")
    warezcdn_enabled: bool = _flag("WAREZCDN_ENABLED", False)
    warezcdn_base_url: str = os.getenv("WAREZCDN_BASE_URL", "https://warezcdn.lat")
    allowed_media_hosts: tuple[str, ...] = _list("STREAM_BRIDGE_ALLOWED_MEDIA_HOSTS")
    s3_endpoint: str = os.getenv("S3_ENDPOINT", "http://localhost:9000")
    s3_region: str = os.getenv("S3_REGION", "us-east-1")
    s3_bucket: str = os.getenv("S3_BUCKET", "zipo-media")
    s3_access_key: str = os.getenv("S3_ACCESS_KEY_ID", "minioadmin")
    s3_secret_key: str = os.getenv("S3_SECRET_ACCESS_KEY", "minioadmin")
    s3_force_path_style: bool = _flag("S3_FORCE_PATH_STYLE", True)
    ffmpeg_path: str = os.getenv("FFMPEG_PATH", "ffmpeg")
    ffprobe_path: str = os.getenv("FFPROBE_PATH", "ffprobe")
    job_ttl_seconds: int = int(os.getenv("MEDIA_CACHE_TTL_SECONDS", "21600"))
    job_database_path: str = os.getenv(
        "STREAM_BRIDGE_JOB_DB",
        str(Path(tempfile.gettempdir()) / "zipo-stream-bridge" / "jobs.sqlite3"),
    )
    max_active_jobs: int = int(os.getenv("STREAM_BRIDGE_MAX_ACTIVE_JOBS", "32"))
    max_job_records: int = int(os.getenv("STREAM_BRIDGE_MAX_JOB_RECORDS", "2000"))
    worker_threads: int = int(os.getenv("STREAM_BRIDGE_WORKERS", "2"))


settings = Settings()

if not 1 <= settings.max_active_jobs <= 1_000:
    raise ValueError("STREAM_BRIDGE_MAX_ACTIVE_JOBS must be between 1 and 1000")
if not 100 <= settings.max_job_records <= 100_000:
    raise ValueError("STREAM_BRIDGE_MAX_JOB_RECORDS must be between 100 and 100000")
if not 1 <= settings.worker_threads <= 16:
    raise ValueError("STREAM_BRIDGE_WORKERS must be between 1 and 16")
if not 300 <= settings.job_ttl_seconds <= 604_800:
    raise ValueError("MEDIA_CACHE_TTL_SECONDS must be between 300 and 604800")
