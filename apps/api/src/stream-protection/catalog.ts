import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { validProtectedVideoId } from "./token";

const SEGMENT_PATTERN = /^segment-(\d{6})\.ts$/;
const MAX_SEGMENTS = 100_000;
const MAX_SEGMENT_BYTES = 64 * 1024 * 1024;

export interface ProtectedVideoAsset {
  videoId: string;
  directory: string;
  segmentFiles: string[];
  segmentDurationSeconds: 10;
  lastSegmentDurationSeconds: number;
}

function videoDirectory(root: string, videoId: string): string | null {
  if (!validProtectedVideoId(videoId)) return null;
  const base = resolve(root);
  const candidate = resolve(base, videoId);
  return candidate.startsWith(`${base}${sep}`) ? candidate : null;
}

export async function loadProtectedVideoAsset(
  root: string,
  videoId: string,
): Promise<ProtectedVideoAsset | null> {
  const directory = videoDirectory(root, videoId);
  if (!directory) return null;
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const segmentFiles = entries
      .filter((entry) => entry.isFile() && SEGMENT_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (!segmentFiles.length || segmentFiles.length > MAX_SEGMENTS) return null;
    for (let index = 0; index < segmentFiles.length; index += 1) {
      if (segmentFiles[index] !== `segment-${String(index).padStart(6, "0")}.ts`) return null;
    }

    let lastSegmentDurationSeconds = 10;
    try {
      const metadata = JSON.parse(await readFile(resolve(directory, "stream.json"), "utf8")) as {
        segmentDurationSeconds?: unknown;
        lastSegmentDurationSeconds?: unknown;
      };
      if (metadata.segmentDurationSeconds !== 10) return null;
      if (
        typeof metadata.lastSegmentDurationSeconds === "number" &&
        metadata.lastSegmentDurationSeconds > 0 &&
        metadata.lastSegmentDurationSeconds <= 10
      ) lastSegmentDurationSeconds = metadata.lastSegmentDurationSeconds;
    } catch {
      return null;
    }

    return {
      videoId,
      directory,
      segmentFiles,
      segmentDurationSeconds: 10,
      lastSegmentDurationSeconds,
    };
  } catch {
    return null;
  }
}

export async function readProtectedSegment(
  asset: ProtectedVideoAsset,
  segmentIndex: number,
): Promise<Buffer | null> {
  if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= asset.segmentFiles.length) {
    return null;
  }
  const path = resolve(asset.directory, asset.segmentFiles[segmentIndex]!);
  if (!path.startsWith(`${asset.directory}${sep}`)) return null;
  try {
    const details = await stat(path);
    if (!details.isFile() || details.size < 1 || details.size > MAX_SEGMENT_BYTES) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

export function createProtectedHlsManifest(asset: ProtectedVideoAsset): string {
  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-TARGETDURATION:10",
    "#EXT-X-MEDIA-SEQUENCE:0",
  ];
  for (let index = 0; index < asset.segmentFiles.length; index += 1) {
    const duration = index === asset.segmentFiles.length - 1
      ? asset.lastSegmentDurationSeconds
      : asset.segmentDurationSeconds;
    lines.push(`#EXTINF:${duration.toFixed(3)},`);
    lines.push(`/api/stream/segment/${encodeURIComponent(asset.videoId)}/${index}`);
  }
  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}
