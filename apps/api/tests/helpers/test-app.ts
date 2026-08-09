import { createApp, type App } from "../../src/app";
import { resetRateLimitStores } from "../../src/plugins/rate-limit";
import { createStore } from "../../src/store/memory";

export interface TestAppOptions {
  rateLimitMax?: number;
  commentRateLimitMax?: number;
  reactionRateLimitMax?: number;
  corsOrigins?: string[];
}

export function createTestApp(options: TestAppOptions = {}): App {
  resetRateLimitStores();
  return createApp({
    store: createStore(),
    corsOrigins: options.corsOrigins ?? [
      "http://localhost:3000",
      "http://localhost:5173",
    ],
    rateLimitMax: options.rateLimitMax ?? 100,
    rateLimitWindowMs: 60_000,
    commentRateLimitMax: options.commentRateLimitMax ?? 5,
    reactionRateLimitMax: options.reactionRateLimitMax ?? 30,
    maxClipsPerDay: 10,
  });
}

export async function request(
  app: App,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `http://localhost${path}`;
  return app.handle(new Request(url, init));
}

export async function json<T = unknown>(
  app: App,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await request(app, path, init);
  const body = (await res.json()) as T;
  return { status: res.status, body, headers: res.headers };
}
