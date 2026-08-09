export * from "./types";

import type {
  Account,
  AggregateManifest,
  AuthSession,
  Clip,
  Comment,
  ContentDetail,
  ContentType,
  CreateClipInput,
  CreateCommentInput,
  CreatePixOrderResult,
  DonationConfig,
  FetchLike,
  HealthResponse,
  PlaybackDiscovery,
  Playlist,
  PlaylistDetail,
  SearchResponse,
  SignInInput,
  SignUpInput,
  ZipoClientOptions,
  ZipoErrorBody,
  ZipoRequestOptions,
} from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

export class ZipoApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(input.message);
    this.name = "ZipoApiError";
    this.status = input.status;
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
  }
}

function trimBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function endpoint(baseUrl: string, path: string, query?: ZipoRequestOptions["query"]): string {
  const pathname = path.startsWith("/") ? path : `/${path}`;
  const target = baseUrl ? `${baseUrl}${pathname}` : pathname;
  if (!query) return target;

  const [withoutHash, hash = ""] = target.split("#", 2);
  const [base, existing = ""] = withoutHash.split("?", 2);
  const params = new URLSearchParams(existing);
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue;
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return `${base}${serialized ? `?${serialized}` : ""}${hash ? `#${hash}` : ""}`;
}

function errorBody(value: unknown): ZipoErrorBody {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  if (body.error && typeof body.error === "object") {
    const nested = body.error as Record<string, unknown>;
    return {
      code: typeof nested.code === "string" ? nested.code : undefined,
      message: typeof nested.message === "string" ? nested.message : undefined,
      details: nested.details,
    };
  }
  return {
    code: typeof body.code === "string" ? body.code : undefined,
    message:
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : undefined,
    details: body.details,
  };
}

/** Framework-agnostic ZiPo client for browsers, Bun and Node.js 20+. */
export class ZipoClient {
  readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly credentials: RequestCredentials;
  private readonly defaultHeaders: Readonly<Record<string, string>>;
  private readonly timeoutMs: number;

  constructor(options: ZipoClientOptions = {}) {
    this.baseUrl = trimBaseUrl(options.baseUrl ?? "");
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (typeof this.fetcher !== "function") {
      throw new TypeError("A Fetch API implementation is required");
    }
    this.credentials = options.credentials ?? "include";
    this.defaultHeaders = { ...options.headers };
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be a positive number");
    }
  }

  async request<T>(path: string, options: ZipoRequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });

    const headers = new Headers(this.defaultHeaders);
    for (const [key, value] of Object.entries(options.headers ?? {})) headers.set(key, value);
    let body: BodyInit | undefined;
    if (options.body != null) {
      if (
        typeof options.body === "string" ||
        options.body instanceof Blob ||
        options.body instanceof FormData ||
        options.body instanceof URLSearchParams ||
        options.body instanceof ArrayBuffer
      ) {
        body = options.body;
      } else {
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(options.body);
      }
    }

    let response: Response;
    try {
      response = await this.fetcher(endpoint(this.baseUrl, path, options.query), {
        method: options.method ?? "GET",
        body,
        credentials: options.credentials ?? this.credentials,
        headers,
        signal: controller.signal,
      });
    } catch (cause) {
      const message = controller.signal.aborted
        ? "ZiPo request was aborted or timed out"
        : "ZiPo API is unreachable";
      throw new ZipoApiError({ status: 0, code: "NETWORK_ERROR", message, details: cause });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const payload: unknown = response.status === 204
      ? undefined
      : contentType.includes("json")
        ? await response.json().catch(() => undefined)
        : await response.text().catch(() => undefined);

    if (!response.ok) {
      const parsed = errorBody(payload);
      throw new ZipoApiError({
        status: response.status,
        code: parsed.code ?? `HTTP_${response.status}`,
        message: parsed.message ?? `ZiPo API request failed (${response.status})`,
        details: parsed.details,
        requestId: response.headers.get("x-request-id") ?? undefined,
      });
    }
    return payload as T;
  }

  health(): Promise<HealthResponse> {
    return this.request("/health");
  }

  getSession(): Promise<AuthSession | null> {
    return this.request<{ user: AuthSession["user"] | null; session: AuthSession["session"] | null }>(
      "/api/auth/get-session",
    ).then((value) => value.user && value.session ? { user: value.user, session: value.session } : null);
  }

  async signIn(input: SignInInput): Promise<AuthSession> {
    await this.request("/api/auth/sign-in/email", { method: "POST", body: input });
    const session = await this.getSession();
    if (!session) throw new ZipoApiError({ status: 401, code: "SESSION_NOT_CREATED", message: "Authentication succeeded without a session" });
    return session;
  }

  async signUp(input: SignUpInput): Promise<AuthSession> {
    await this.request("/api/auth/sign-up/email", { method: "POST", body: input });
    const session = await this.getSession();
    if (session) return session;
    return this.signIn({ email: input.email, password: input.password });
  }

  signOut(): Promise<void> {
    return this.request("/api/auth/sign-out", { method: "POST" });
  }

  account(): Promise<Account> {
    return this.request("/api/v1/account/me");
  }

  search(query: string, options: { type?: ContentType; page?: number; limit?: number } = {}): Promise<SearchResponse> {
    return this.request("/api/v1/search", { query: { q: query, ...options } });
  }

  content(type: ContentType, id: string, locale?: string): Promise<ContentDetail> {
    return this.request(`/api/v1/content/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { query: { locale } });
  }

  aggregate(type: ContentType, id: string, options: { locale?: string; season?: number; episode?: number; includePlayback?: boolean } = {}): Promise<AggregateManifest> {
    return this.request(`/api/v2/aggregate/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { query: options });
  }

  discoverPlayback(type: ContentType, id: string, options: { season?: number; episode?: number; audioLang?: string; subtitleLang?: string } = {}): Promise<PlaybackDiscovery> {
    return this.request(`/api/v1/playback/discover/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { query: options });
  }

  comments(contentType: "anime" | "series", contentId: string, options: { cursor?: string; limit?: number } = {}): Promise<{ data: Comment[]; nextCursor?: string; hasMore: boolean }> {
    return this.request(`/api/v1/${contentType}/${encodeURIComponent(contentId)}/comments`, { query: options });
  }

  createComment(contentType: "anime" | "series", contentId: string, input: CreateCommentInput): Promise<Comment> {
    return this.request(`/api/v1/${contentType}/${encodeURIComponent(contentId)}/comments`, { method: "POST", body: input });
  }

  createClip(input: CreateClipInput): Promise<Clip> {
    return this.request("/api/v1/clips", { method: "POST", body: input });
  }

  playlists(): Promise<{ playlists: Playlist[] }> {
    return this.request("/api/v1/playlists");
  }

  playlist(id: string): Promise<PlaylistDetail> {
    return this.request(`/api/v1/playlists/${encodeURIComponent(id)}`);
  }

  donationConfig(): Promise<DonationConfig> {
    return this.request("/api/v1/donate/config");
  }

  createPixOrder(idempotencyKey: string): Promise<CreatePixOrderResult> {
    return this.request("/api/v1/donate/pix", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
    });
  }
}

export function createApiClient(baseUrlOrOptions: string | ZipoClientOptions = {}): ZipoClient {
  return new ZipoClient(typeof baseUrlOrOptions === "string" ? { baseUrl: baseUrlOrOptions } : baseUrlOrOptions);
}

export const api = createApiClient();
export default api;
