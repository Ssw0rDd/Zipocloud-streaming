const SHIKIMORI_BASE = "https://shikimori.one/api";

interface ShikimoriAnime {
  id: number;
  name: string;
  russian?: string;
  description?: string;
  description_html?: string;
  score?: string;
  mal_id?: number;
}

export async function getShikimoriByMalId(malId: number): Promise<ShikimoriAnime | null> {
  try {
    const res = await fetch(`${SHIKIMORI_BASE}/animes/${malId}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as ShikimoriAnime;
  } catch {
    return null;
  }
}

export function stripHtml(html?: string): string | undefined {
  if (!html) return undefined;
  return html.replace(/<[^>]+>/g, "").trim();
}
