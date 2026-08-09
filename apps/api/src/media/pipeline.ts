import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

export interface PipelineOptions {
  streamUrl: string;
  headers: Record<string, string>;
  outputPath: string;
  timeoutMs?: number;
  ffmpegPath?: string;
}

export interface PipelineProgress {
  attempt: number;
  frame?: number;
  fps?: number;
  outTimeMs?: number;
  speed?: string;
  state: "processing" | "end";
}

export class StreamPipelineError extends Error {
  constructor(
    message: string,
    readonly attempts: number,
    readonly stderr: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StreamPipelineError";
  }
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const MAX_HEADER_VALUE_BYTES = 8_192;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 500, 1_500] as const;
const STDERR_LIMIT = 16_384;

function validateStreamUrl(raw: string): string {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new TypeError("streamUrl must be an HTTP(S) URL without embedded credentials");
  }
  return url.toString();
}

export function serializeFfmpegHeaders(headers: Record<string, string>): string {
  const lines = Object.entries(headers).map(([name, value]) => {
    if (!HEADER_NAME.test(name) || /[\r\n]/.test(value)) {
      throw new TypeError("Invalid ffmpeg input header");
    }
    if (Buffer.byteLength(value) > MAX_HEADER_VALUE_BYTES) {
      throw new TypeError("ffmpeg input header is too large");
    }
    return `${name}: ${value}`;
  });
  return lines.length ? `${lines.join("\r\n")}\r\n` : "";
}

export function buildFfmpegArgs(options: PipelineOptions, tempOutputPath: string): string[] {
  const streamUrl = validateStreamUrl(options.streamUrl);
  const serializedHeaders = serializeFfmpegHeaders(options.headers);
  return [
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    ...(serializedHeaders ? ["-headers", serializedHeaders] : []),
    "-i", streamUrl,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c", "copy",
    "-movflags", "+faststart",
    "-progress", "pipe:1",
    "-nostats",
    "-n",
    tempOutputPath,
  ];
}

function shellQuote(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Diagnostic command only. Do not log it when headers contain credentials. */
export function formatFfmpegCommand(options: PipelineOptions, tempOutputPath: string): string {
  return [options.ffmpegPath ?? "ffmpeg", ...buildFfmpegArgs(options, tempOutputPath)]
    .map(shellQuote)
    .join(" ");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function abortError(): Error {
  const error = new Error("Stream pipeline aborted");
  error.name = "AbortError";
  return error;
}

export class StreamPipeline extends EventEmitter {
  private activeProcess: ChildProcess | null = null;
  private started = false;
  private aborted = false;

  constructor(private readonly options: PipelineOptions) {
    super();
  }

  async start(): Promise<string> {
    if (this.started) throw new Error("Stream pipeline can only be started once");
    this.started = true;

    try {
      validateStreamUrl(this.options.streamUrl);
      serializeFfmpegHeaders(this.options.headers);
      if (!this.options.outputPath.trim()) throw new TypeError("outputPath is required");
      if ((this.options.timeoutMs ?? 30_000) < 1_000) {
        throw new TypeError("timeoutMs must be at least 1000ms");
      }
      await access(this.options.outputPath).then(
        () => { throw new Error("outputPath already exists"); },
        () => undefined,
      );
      await mkdir(dirname(this.options.outputPath), { recursive: true });

      let lastError: Error | null = null;
      let lastStderr = "";
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        if (this.aborted) throw abortError();
        if (RETRY_DELAYS_MS[attempt - 1]) await delay(RETRY_DELAYS_MS[attempt - 1]!);
        const tempOutput = `${this.options.outputPath}.${randomUUID()}.tmp.mp4`;
        try {
          const result = await this.runAttempt(attempt, tempOutput);
          lastStderr = result.stderr;
          await rename(tempOutput, this.options.outputPath);
          this.emit("complete", this.options.outputPath);
          return this.options.outputPath;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (lastError instanceof StreamPipelineError) lastStderr = lastError.stderr;
          await rm(tempOutput, { force: true }).catch(() => undefined);
          if (this.aborted || lastError.name === "AbortError") throw abortError();
        }
      }

      throw new StreamPipelineError(
        `ffmpeg failed after ${MAX_ATTEMPTS} attempts: ${lastError?.message ?? "unknown error"}`,
        MAX_ATTEMPTS,
        lastStderr,
        lastError ? { cause: lastError } : undefined,
      );
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (this.listenerCount("error") > 0) this.emit("error", normalized);
      throw normalized;
    } finally {
      this.activeProcess = null;
    }
  }

  abort(): void {
    this.aborted = true;
    const process = this.activeProcess;
    if (!process || process.exitCode != null || process.signalCode != null) return;
    process.kill("SIGTERM");
    const forceKill = setTimeout(() => {
      if (process.exitCode == null && process.signalCode == null) process.kill("SIGKILL");
    }, 2_000);
    forceKill.unref();
  }

  private runAttempt(attempt: number, tempOutput: string): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.timeoutMs ?? 30_000;
      const child = spawn(
        this.options.ffmpegPath ?? "ffmpeg",
        buildFfmpegArgs(this.options, tempOutput),
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      this.activeProcess = child;

      let stderr = "";
      let timedOut = false;
      let settled = false;
      let watchdog: NodeJS.Timeout;
      let forceKill: NodeJS.Timeout | null = null;
      const resetWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          forceKill = setTimeout(() => {
            if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
          }, 2_000);
          forceKill.unref();
        }, timeoutMs);
        watchdog.unref();
      };
      resetWatchdog();

      const progress: Record<string, string> = {};
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        resetWatchdog();
        const separator = line.indexOf("=");
        if (separator < 1) return;
        progress[line.slice(0, separator)] = line.slice(separator + 1);
        if (line.startsWith("progress=")) {
          const event: PipelineProgress = {
            attempt,
            state: progress.progress === "end" ? "end" : "processing",
            ...(Number.isFinite(Number(progress.frame)) ? { frame: Number(progress.frame) } : {}),
            ...(Number.isFinite(Number(progress.fps)) ? { fps: Number(progress.fps) } : {}),
            ...(Number.isFinite(Number(progress.out_time_ms))
              ? { outTimeMs: Number(progress.out_time_ms) / 1_000 }
              : {}),
            ...(progress.speed ? { speed: progress.speed } : {}),
          };
          this.emit("progress", event);
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        resetWatchdog();
        stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_LIMIT);
      });
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (forceKill) clearTimeout(forceKill);
        lines.close();
        reject(new StreamPipelineError(error.message, attempt, stderr, { cause: error }));
      });
      child.once("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(watchdog);
        if (forceKill) clearTimeout(forceKill);
        lines.close();
        this.activeProcess = null;
        if (this.aborted) return reject(abortError());
        if (code === 0) return resolve({ stderr });
        const reason = timedOut
          ? `ffmpeg made no progress for ${timeoutMs}ms`
          : `ffmpeg exited with code ${code ?? "null"}${signal ? ` (${signal})` : ""}`;
        reject(new StreamPipelineError(reason, attempt, stderr));
      });
    });
  }
}
