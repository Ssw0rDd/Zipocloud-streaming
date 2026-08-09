import { env } from "../env";

export type VideoEncoder = "h264_nvenc" | "h264_amf" | "libx264";

let cachedEncoder: VideoEncoder | null = null;
let probePromise: Promise<VideoEncoder> | null = null;

/**
 * Prefer NVIDIA nvenc / AMD amf when available; always fall back to libx264.
 * Controlled by FFMPEG_HWACCEL=auto|nvenc|amf|none (default auto).
 */
export async function resolveVideoEncoder(): Promise<VideoEncoder> {
  if (cachedEncoder) return cachedEncoder;
  if (!probePromise) probePromise = probeEncoder();
  cachedEncoder = await probePromise;
  return cachedEncoder;
}

async function probeEncoder(): Promise<VideoEncoder> {
  const mode = (process.env.FFMPEG_HWACCEL ?? "auto").toLowerCase();
  if (mode === "none" || mode === "off" || mode === "cpu") return "libx264";
  if (mode === "nvenc") {
    return (await encoderWorks("h264_nvenc")) ? "h264_nvenc" : "libx264";
  }
  if (mode === "amf") {
    return (await encoderWorks("h264_amf")) ? "h264_amf" : "libx264";
  }

  if (await encoderWorks("h264_nvenc")) return "h264_nvenc";
  if (await encoderWorks("h264_amf")) return "h264_amf";
  return "libx264";
}

async function encoderWorks(encoder: VideoEncoder): Promise<boolean> {
  try {
    const process = Bun.spawn(
      [
        env.FFMPEG_PATH,
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x64:d=0.1",
        "-frames:v",
        "1",
        "-c:v",
        encoder,
        "-f",
        "null",
        "-",
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    const code = await process.exited;
    return code === 0;
  } catch {
    return false;
  }
}

export function encoderArgs(encoder: VideoEncoder): string[] {
  if (encoder === "h264_nvenc") {
    return ["-c:v", "h264_nvenc", "-preset", "p4", "-cq", "23"];
  }
  if (encoder === "h264_amf") {
    return ["-c:v", "h264_amf", "-quality", "balanced", "-rc", "cqp", "-qp_i", "22", "-qp_p", "22"];
  }
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22"];
}
