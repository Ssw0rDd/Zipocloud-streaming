import { siteModeHeaders } from "./site-mode";

/** Browser: same-origin `/api` (Next rewrite → API). SSR: direct internal URL. */
export function getApiBaseUrl(): string {
  if (typeof window !== "undefined") return "";
  return process.env.API_URL ?? "http://localhost:3001";
}

const API_URL = getApiBaseUrl();
const PROFILE_STORAGE_KEY = "zipo-active-profile";

function activeProfileHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const profileId = window.localStorage.getItem(PROFILE_STORAGE_KEY)?.trim();
  return profileId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)
    ? { "X-ZiPo-Profile-Id": profileId }
    : {};
}

export function setActiveProfileId(profileId: string | null): void {
  if (typeof window === "undefined") return;
  if (profileId) window.localStorage.setItem(PROFILE_STORAGE_KEY, profileId);
  else window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("zipo:profile-change", { detail: profileId }));
}

export function getActiveProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PROFILE_STORAGE_KEY);
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code = "API_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...siteModeHeaders(),
      ...activeProfileHeaders(),
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null) as {
      error?: unknown;
      code?: unknown;
      details?: unknown;
    } | null;
    throw new ApiClientError(
      typeof err?.error === "string" ? err.error : `API error ${res.status}`,
      res.status,
      typeof err?.code === "string" ? err.code : "API_ERROR",
      err?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export { API_URL };
