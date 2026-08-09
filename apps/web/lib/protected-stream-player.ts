import Hls, {
  LoadStats,
  type FragmentLoaderConstructor,
  type FragmentLoaderContext,
  type HlsConfig,
  type Loader,
  type LoaderCallbacks,
  type LoaderConfiguration,
} from "hls.js";

interface StreamBootstrap {
  sessionToken: string;
  totalSegments: number;
  expiresAt: number;
  manifestUrl: string;
  serverPublicKey: string;
  wrappedSessionKey: string;
  keyWrapIv: string;
}

export interface ProtectedStreamPlayerOptions {
  container: HTMLElement;
  video: HTMLVideoElement;
  videoId: string;
  userId: string;
  apiBaseUrl?: string;
}

interface LoaderSession {
  token: string;
  videoId: string;
  key: CryptoKey;
  queue: Promise<void>;
}

const textEncoder = new TextEncoder();

function utf8(value: string): Uint8Array<ArrayBuffer> {
  const encoded = textEncoder.encode(value);
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[a-f0-9]{24}$/i.test(value)) throw new Error("Invalid segment IV");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function segmentAad(token: string, videoId: string, segmentIndex: number): Uint8Array<ArrayBuffer> {
  return utf8(`zipo:segment:v1\n${token}\n${videoId}\n${segmentIndex}`);
}

export async function decryptProtectedSegment(input: {
  encrypted: ArrayBuffer;
  ivHex: string;
  sessionKey: CryptoKey;
  sessionToken: string;
  videoId: string;
  segmentIndex: number;
}): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromHex(input.ivHex),
      additionalData: segmentAad(input.sessionToken, input.videoId, input.segmentIndex),
      tagLength: 128,
    },
    input.sessionKey,
    input.encrypted,
  );
}

async function unwrapSessionKey(input: {
  privateKey: CryptoKey;
  serverPublicKey: string;
  wrappedSessionKey: string;
  keyWrapIv: string;
  sessionToken: string;
}): Promise<CryptoKey> {
  const serverPublicKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(input.serverPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    input.privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8(input.sessionToken),
      info: utf8("zipo-segment-key-wrap-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const rawSessionKey = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(input.keyWrapIv),
      additionalData: utf8(`zipo:key-wrap:v1\n${input.sessionToken}`),
      tagLength: 128,
    },
    wrappingKey,
    fromBase64Url(input.wrappedSessionKey),
  );
  return crypto.subtle.importKey("raw", rawSessionKey, { name: "AES-GCM" }, false, ["decrypt"]);
}

function encryptedFragmentLoader(session: LoaderSession): FragmentLoaderConstructor {
  return class SequentialEncryptedFragmentLoader implements Loader<FragmentLoaderContext> {
    context: FragmentLoaderContext | null = null;
    stats = new LoadStats();
    private controller: AbortController | null = null;
    private aborted = false;

    constructor(_config: HlsConfig) {
      void _config;
    }

    load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ): void {
      this.context = context;
      const operation = session.queue.then(() => this.loadSequential(context, config, callbacks));
      session.queue = operation.then(() => undefined, () => undefined);
    }

    abort(): void {
      this.aborted = true;
      this.stats.aborted = true;
      this.controller?.abort();
    }

    destroy(): void {
      this.abort();
      this.context = null;
    }

    private async loadSequential(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ): Promise<void> {
      if (this.aborted) {
        callbacks.onAbort?.(this.stats, context, null);
        return;
      }
      const url = new URL(context.url, location.origin);
      const match = /^\/api\/stream\/segment\/([^/]+)\/(\d+)$/.exec(url.pathname);
      const segmentIndex = Number(match?.[2]);
      if (!match || decodeURIComponent(match[1]!) !== session.videoId || !Number.isSafeInteger(segmentIndex)) {
        callbacks.onError({ code: 400, text: "Unexpected segment URL" }, context, null, this.stats);
        return;
      }

      this.controller = new AbortController();
      const maxLoadMs = config.loadPolicy?.maxLoadTimeMs ?? config.timeout ?? 30_000;
      const timeout = setTimeout(() => this.controller?.abort("timeout"), maxLoadMs);
      const startedAt = performance.now();
      this.stats.loading.start = startedAt;
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${session.token}` },
          credentials: "include",
          cache: "no-store",
          signal: this.controller.signal,
        });
        if (!response.ok) {
          callbacks.onError(
            { code: response.status, text: `Segment request failed (${response.status})` },
            context,
            response,
            this.stats,
          );
          return;
        }
        const encrypted = await response.arrayBuffer();
        const ivHex = response.headers.get("x-segment-iv") ?? "";
        const decrypted = await decryptProtectedSegment({
          encrypted,
          ivHex,
          sessionKey: session.key,
          sessionToken: session.token,
          videoId: session.videoId,
          segmentIndex,
        });
        const endedAt = performance.now();
        this.stats.loaded = decrypted.byteLength;
        this.stats.total = decrypted.byteLength;
        this.stats.loading.end = endedAt;
        this.stats.bwEstimate = Math.round((decrypted.byteLength * 8 * 1_000) / Math.max(1, endedAt - startedAt));
        callbacks.onProgress?.(this.stats, context, decrypted, response);
        callbacks.onSuccess(
          { url: context.url, data: decrypted, code: response.status },
          this.stats,
          context,
          response,
        );
      } catch (error) {
        if (this.aborted) callbacks.onAbort?.(this.stats, context, error);
        else if (this.controller.signal.aborted) callbacks.onTimeout(this.stats, context, error);
        else callbacks.onError(
          { code: 0, text: error instanceof Error ? error.message : "Segment load failed" },
          context,
          error,
          this.stats,
        );
      } finally {
        clearTimeout(timeout);
        this.controller = null;
      }
    }
  };
}

export class ProtectedStreamPlayer extends EventTarget {
  private hls: Hls | null = null;
  private sessionToken: string | null = null;
  private sessionKey: CryptoKey | null = null;
  private watermark: HTMLCanvasElement | null = null;
  private watermarkTimer: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private started = false;

  constructor(private readonly options: ProtectedStreamPlayerOptions) {
    super();
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("ProtectedStreamPlayer can only be started once");
    if (!Hls.isSupported()) throw new Error("MediaSource playback is not supported by this browser");
    this.started = true;
    try {
      this.installPlaybackControls();
      this.installWatermark();

      const keyPair = await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        false,
        ["deriveBits"],
      );
      const publicKey = new Uint8Array(
        await crypto.subtle.exportKey("raw", keyPair.publicKey),
      );
      const base = (this.options.apiBaseUrl ?? "").replace(/\/$/, "");
      const response = await fetch(
        `${base}/api/stream/init/${encodeURIComponent(this.options.videoId)}`,
        {
          method: "GET",
          headers: { "X-Client-Public-Key": base64Url(publicKey) },
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) {
        throw new Error(`Protected stream initialization failed (${response.status})`);
      }
      const bootstrap = await response.json() as StreamBootstrap;
      this.sessionToken = bootstrap.sessionToken;
      this.sessionKey = await unwrapSessionKey({
        privateKey: keyPair.privateKey,
        serverPublicKey: bootstrap.serverPublicKey,
        wrappedSessionKey: bootstrap.wrappedSessionKey,
        keyWrapIv: bootstrap.keyWrapIv,
        sessionToken: bootstrap.sessionToken,
      });

      const loaderSession: LoaderSession = {
        token: bootstrap.sessionToken,
        videoId: this.options.videoId,
        key: this.sessionKey,
        queue: Promise.resolve(),
      };
      const authorization = `Bearer ${bootstrap.sessionToken}`;
      this.hls = new Hls({
        fLoader: encryptedFragmentLoader(loaderSession),
        maxBufferLength: 20,
        maxMaxBufferLength: 30,
        startFragPrefetch: false,
        fetchSetup(context, init) {
          const headers = new Headers(init.headers);
          headers.set("Authorization", authorization);
          return new Request(context.url, {
            ...init,
            headers,
            credentials: "include",
            cache: "no-store",
          });
        },
        xhrSetup(xhr) {
          xhr.withCredentials = true;
          xhr.setRequestHeader("Authorization", authorization);
        },
      });
      this.hls.attachMedia(this.options.video);

      await new Promise<void>((resolve, reject) => {
        const onAttached = () => this.hls?.loadSource(`${base}${bootstrap.manifestUrl}`);
        const onParsed = () => {
          cleanup();
          resolve();
        };
        const onError = (_event: string, data: { fatal: boolean; details: string }) => {
          if (!data.fatal) return;
          cleanup();
          reject(new Error(`Protected HLS playback failed: ${data.details}`));
        };
        const cleanup = () => {
          this.hls?.off(Hls.Events.MEDIA_ATTACHED, onAttached);
          this.hls?.off(Hls.Events.MANIFEST_PARSED, onParsed);
          this.hls?.off(Hls.Events.ERROR, onError);
        };
        this.hls?.on(Hls.Events.MEDIA_ATTACHED, onAttached);
        this.hls?.on(Hls.Events.MANIFEST_PARSED, onParsed);
        this.hls?.on(Hls.Events.ERROR, onError);
      });
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy(): void {
    this.hls?.destroy();
    this.hls = null;
    this.sessionKey = null;
    this.sessionToken = null;
    if (this.watermarkTimer != null) window.clearInterval(this.watermarkTimer);
    this.resizeObserver?.disconnect();
    this.watermark?.remove();
    this.watermark = null;
    this.options.container.removeEventListener("contextmenu", this.preventDefault);
    this.options.container.removeEventListener("dragstart", this.preventDefault);
    this.options.container.removeEventListener("keydown", this.preventDownloadKeys);
  }

  private readonly preventDefault = (event: Event) => event.preventDefault();

  private readonly preventDownloadKeys = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key === "s" || ((event.ctrlKey || event.metaKey) && ["s", "u"].includes(key))) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private installPlaybackControls(): void {
    this.options.container.addEventListener("contextmenu", this.preventDefault);
    this.options.container.addEventListener("dragstart", this.preventDefault);
    this.options.container.addEventListener("keydown", this.preventDownloadKeys);
    this.options.video.setAttribute("controlsList", "nodownload noremoteplayback");
    this.options.video.disablePictureInPicture = true;
    this.options.video.disableRemotePlayback = true;
  }

  private installWatermark(): void {
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "20",
    });
    const computed = getComputedStyle(this.options.container);
    if (computed.position === "static") this.options.container.style.position = "relative";
    this.options.container.append(canvas);
    this.watermark = canvas;
    this.drawWatermark();
    this.watermarkTimer = window.setInterval(() => this.drawWatermark(), 30_000);
    this.resizeObserver = new ResizeObserver(() => this.drawWatermark());
    this.resizeObserver.observe(this.options.container);
  }

  private drawWatermark(): void {
    const canvas = this.watermark;
    if (!canvas) return;
    const bounds = this.options.container.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.globalAlpha = 0.1;
    context.fillStyle = "#ffffff";
    context.font = "600 16px Manrope, sans-serif";
    context.textAlign = "center";
    context.translate(bounds.width / 2, bounds.height / 2);
    context.rotate(-Math.PI / 4);
    const offset = crypto.getRandomValues(new Uint16Array(1))[0]! % 80;
    for (let y = -bounds.height; y <= bounds.height; y += 120) {
      for (let x = -bounds.width; x <= bounds.width; x += 280) {
        context.fillText(this.options.userId, x + offset, y);
      }
    }
  }
}
