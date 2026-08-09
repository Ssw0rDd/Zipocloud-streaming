/**
 * AniPub public API — metadata only (characters/voice actors). No playback.
 * https://api.anipub.xyz
 */

export interface AniPubCharacter {
  name: string;
  image?: string;
  role?: string;
  voiceActor?: string;
}

interface AniPubJikanCharacter {
  character?: { name?: string; images?: { jpg?: { image_url?: string } } };
  role?: string;
  voice_actors?: Array<{
    person?: { name?: string };
    language?: string;
  }>;
}

export async function fetchAniPubCharacters(
  malId: number,
): Promise<AniPubCharacter[]> {
  try {
    const res = await fetch(
      `https://api.anipub.xyz/anime/api/details/${malId}`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      characters?: AniPubJikanCharacter[];
    };
    return (data.characters ?? []).map((edge) => {
      const va = edge.voice_actors?.find((v) => v.language === "Japanese") ??
        edge.voice_actors?.[0];
      return {
        name: edge.character?.name ?? "Unknown",
        image: edge.character?.images?.jpg?.image_url,
        role: edge.role,
        voiceActor: va?.person?.name,
      };
    });
  } catch {
    return [];
  }
}
