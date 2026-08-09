import type { Clip } from "@zipo/shared";
import { siteModeHeaders } from "./site-mode";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export async function fetchClipServer(token: string): Promise<Clip> {
  const res = await fetch(`${API_URL}/api/v1/clips/${token}`, {
    headers: siteModeHeaders(),
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error("Clip not found");
  return res.json() as Promise<Clip>;
}

export async function fetchContentPoster(
  contentType: string,
  contentId: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(`${API_URL}/api/v1/content/${contentType}/${contentId}`, {
      headers: siteModeHeaders(),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { posterUrl?: string; poster?: string };
    return data.posterUrl ?? data.poster;
  } catch {
    return undefined;
  }
}
