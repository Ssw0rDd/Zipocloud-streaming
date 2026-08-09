from __future__ import annotations

import argparse
import asyncio
import logging
import shutil
import sys
import tempfile
from pathlib import Path

from converter import convert_single_quality
from extractor import extract_stream
from storage import upload_directory

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


async def main() -> int:
    parser = argparse.ArgumentParser(description="ZiPo Stream Bridge CLI (dev)")
    parser.add_argument("--type", required=True, choices=["movie", "series", "anime"])
    parser.add_argument("--id", required=True, dest="content_id")
    parser.add_argument("--season", type=int)
    parser.add_argument("--episode", type=int)
    parser.add_argument("--quality", type=int, default=720)
    args = parser.parse_args()

    extracted = await extract_stream(
        content_type=args.type,
        content_id=args.content_id,
        season=args.season,
        episode=args.episode,
    )
    print(f"Extracted {extracted.stream_type}: {extracted.stream_url}")

    work_dir = Path(tempfile.mkdtemp(prefix="zipo-bridge-cli-"))
    try:
        await convert_single_quality(extracted.stream_url, work_dir)
        job_id = "cli-dev"
        prefix = f"playback-cache/cinema/{job_id}/"
        upload_directory(work_dir, prefix)
        print(f"Uploaded to s3://{prefix}master.m3u8")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
