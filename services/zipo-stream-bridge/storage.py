from __future__ import annotations

import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import boto3
from botocore.client import Config

from config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"}),
    )


def _content_type(path: Path) -> str:
    if path.suffix == ".m3u8":
        return "application/vnd.apple.mpegurl"
    if path.suffix == ".ts":
        return "video/mp2t"
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def upload_directory(local_dir: Path, output_prefix: str) -> None:
    if not output_prefix.endswith("/"):
        output_prefix = f"{output_prefix}/"
    if ".." in output_prefix or not output_prefix.startswith("playback-cache/cinema/"):
        raise ValueError("Invalid cinema output prefix")

    files = [
        path
        for path in local_dir.rglob("*")
        if path.is_file() and path.suffix in {".m3u8", ".ts"}
    ]
    if not files:
        raise ValueError("No HLS artifacts to upload")

    client = _client()
    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = {
            pool.submit(_upload_file, client, path, local_dir, output_prefix): path
            for path in files
        }
        for future in as_completed(futures):
            future.result()


def _upload_file(client, path: Path, root: Path, output_prefix: str) -> None:
    key = f"{output_prefix}{path.relative_to(root).as_posix()}"
    client.put_object(
        Bucket=settings.s3_bucket,
        Key=key,
        Body=path.read_bytes(),
        ContentType=_content_type(path),
        CacheControl="private, max-age=300",
    )
