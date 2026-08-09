from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import textwrap
from pathlib import Path

from config import settings

LOGGER = logging.getLogger(__name__)
QUALITIES = (
    ("480p", 854, 480, "800k"),
    ("720p", 1280, 720, "1800k"),
    ("1080p", 1920, 1080, "3500k"),
)


def _run(args: list[str], timeout: int = 3_600) -> None:
    process = subprocess.run(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if process.returncode != 0:
        detail = process.stderr.decode("utf-8", errors="ignore")[-500:]
        raise RuntimeError(f"FFmpeg failed ({process.returncode}): {detail}")


def detect_nvenc() -> bool:
    try:
        result = subprocess.run(
            [settings.ffmpeg_path, "-hide_banner", "-encoders"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    output = result.stdout.decode("utf-8", errors="ignore").lower()
    return "h264_nvenc" in output


def _video_encoder_args(use_nvenc: bool) -> list[str]:
    if use_nvenc:
        return [
            "-hwaccel", "cuda",
            "-c:v", "h264_nvenc",
            "-preset", "fast",
        ]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"]


def _transcode_variant(
    input_url: str,
    output_dir: Path,
    label: str,
    width: int,
    height: int,
    video_bitrate: str,
    use_nvenc: bool,
) -> Path:
    variant_dir = output_dir / label
    variant_dir.mkdir(parents=True, exist_ok=True)
    playlist = variant_dir / "playlist.m3u8"
    segment_pattern = variant_dir / "segment-%06d.ts"
    scale = f"scale=w={width}:h={height}:force_original_aspect_ratio=decrease"
    pad = f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
    args = [
        settings.ffmpeg_path,
        "-nostdin",
        "-hide_banner",
        "-loglevel", "error",
        "-i", input_url,
        "-map", "0:v:0?",
        "-map", "0:a:0?",
        *_video_encoder_args(use_nvenc),
        "-vf", f"{scale},{pad}",
        "-b:v", video_bitrate,
        "-maxrate", video_bitrate,
        "-bufsize", str(int(video_bitrate.rstrip("k")) * 2) + "k",
        "-c:a", "aac",
        "-b:a", "128k",
        "-f", "hls",
        "-hls_time", "4",
        "-hls_playlist_type", "vod",
        "-hls_flags", "independent_segments+temp_file",
        "-hls_segment_filename", str(segment_pattern),
        "-y",
        str(playlist),
    ]
    _run(args)
    if not playlist.exists():
        raise RuntimeError(f"Missing variant playlist for {label}")
    return playlist


def _write_master_playlist(output_dir: Path, variants: list[tuple[str, str]]) -> Path:
    lines = ["#EXTM3U", "#EXT-X-VERSION:3"]
    for bandwidth, label in variants:
        lines.append(f"#EXT-X-STREAM-INF:BANDWIDTH={bandwidth},RESOLUTION={_resolution(label)}")
        lines.append(f"{label}/playlist.m3u8")
    master = output_dir / "master.m3u8"
    master.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return master


def _resolution(label: str) -> str:
    mapping = {"480p": "854x480", "720p": "1280x720", "1080p": "1920x1080"}
    return mapping.get(label, "1280x720")


def _bandwidth(label: str) -> str:
    mapping = {"480p": "900000", "720p": "2000000", "1080p": "4000000"}
    return mapping.get(label, "2000000")


async def convert_to_hls(
    input_url: str,
    output_dir: Path,
    qualities: list[int] | None = None,
    progress_callback=None,
) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    selected = [entry for entry in QUALITIES if not qualities or int(entry[0][:-1]) in qualities]
    if not selected:
        selected = [QUALITIES[1]]

    use_nvenc = detect_nvenc()
    LOGGER.info("Transcoding with %s (%d variants)", "NVENC" if use_nvenc else "libx264", len(selected))

    loop = asyncio.get_running_loop()
    variants: list[tuple[str, str]] = []
    total = len(selected)
    for index, (label, width, height, bitrate) in enumerate(selected):
        await loop.run_in_executor(
            None,
            _transcode_variant,
            input_url,
            output_dir,
            label,
            width,
            height,
            bitrate,
            use_nvenc,
        )
        variants.append((_bandwidth(label), label))
        if progress_callback:
            progress_callback(20 + int(((index + 1) / total) * 60))

    master = _write_master_playlist(output_dir, variants)
    if progress_callback:
        progress_callback(85)
    return master


async def convert_single_quality(input_url: str, output_dir: Path) -> Path:
    """Dev CLI helper — 720p only."""
    return await convert_to_hls(input_url, output_dir, qualities=[720])
