const ANILIST_URL = "https://graphql.anilist.co";

interface AniListMedia {
  id: number;
  idMal?: number;
  title: { romaji?: string; english?: string; native?: string };
  description?: string;
  coverImage?: { large?: string; extraLarge?: string };
  bannerImage?: string;
  startDate?: { year?: number };
  averageScore?: number;
  genres?: string[];
  isAdult?: boolean;
  episodes?: number;
  status?: string;
  duration?: number;
}

export interface AniListCharacter {
  id: number;
  name: { full: string };
  image?: { large?: string; medium?: string };
}

export interface AniListCharacterEdge {
  role?: string;
  node: AniListCharacter;
}

export interface AniListRelationEdge {
  relationType?: string;
  node: {
    id: number;
    type?: string;
    title: { romaji?: string; english?: string };
    idMal?: number;
  };
}

export interface AniListRecommendation {
  id: number;
  title: { romaji?: string; english?: string };
  coverImage?: { large?: string };
  idMal?: number;
}

export interface AniListStreamingEpisode {
  title?: string;
  thumbnail?: string;
  url?: string;
  site?: string;
}

export interface AniListMediaExpanded extends AniListMedia {
  characters?: { edges: AniListCharacterEdge[] };
  relations?: { edges: AniListRelationEdge[] };
  recommendations?: { nodes: { mediaRecommendation: AniListRecommendation }[] };
  streamingEpisodes?: AniListStreamingEpisode[];
}

async function anilistQuery<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`AniList error: ${res.status}`);
  }
  const json = (await res.json()) as { data: T; errors?: unknown[] };
  if (json.errors?.length) {
    throw new Error(`AniList GraphQL error`);
  }
  return json.data;
}

const SEARCH_QUERY = `
  query ($search: String, $perPage: Int) {
    Page(perPage: $perPage) {
      media(search: $search, type: ANIME) {
        id idMal
        title { romaji english native }
        description
        coverImage { large extraLarge }
        bannerImage
        startDate { year }
        averageScore
        genres
        isAdult
      }
    }
  }
`;

const MEDIA_QUERY = `
  query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id idMal
      title { romaji english native }
      description
      coverImage { large extraLarge }
      bannerImage
      startDate { year }
      averageScore
      genres
      isAdult
      episodes
      status
      duration
    }
  }
`;

const MEDIA_EXPANDED_QUERY = `
  query ($id: Int, $idMal: Int) {
    Media(id: $id, idMal: $idMal, type: ANIME) {
      id idMal
      title { romaji english native }
      description
      coverImage { large extraLarge }
      bannerImage
      startDate { year }
      averageScore
      genres
      isAdult
      episodes
      status
      duration
      characters(perPage: 25, sort: ROLE) {
        edges {
          role
          node {
            id
            name { full }
            image { large medium }
          }
        }
      }
      relations {
        edges {
          relationType
          node {
            id
            type
            idMal
            title { romaji english }
          }
        }
      }
      recommendations(perPage: 12, sort: RATING_DESC) {
        nodes {
          mediaRecommendation {
            id
            idMal
            title { romaji english }
            coverImage { large }
          }
        }
      }
      streamingEpisodes {
        title
        thumbnail
        url
        site
      }
    }
  }
`;

export async function searchAniList(query: string, limit = 20) {
  const data = await anilistQuery<{ Page: { media: AniListMedia[] } }>(
    SEARCH_QUERY,
    { search: query, perPage: limit },
  );
  return data.Page.media;
}

const ADULT_PAGE_QUERY = `
  query ($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { total lastPage }
      media(type: ANIME, isAdult: true, sort: POPULARITY_DESC) {
        id idMal
        title { romaji english native }
        description
        coverImage { large extraLarge }
        bannerImage
        startDate { year }
        averageScore
        genres
        isAdult
      }
    }
  }
`;

/** Adult anime browse for the NSFW site (hentai / explicit). */
export async function getAniListAdultPage(page = 1, limit = 25) {
  const data = await anilistQuery<{
    Page: {
      pageInfo?: { total?: number; lastPage?: number };
      media: AniListMedia[];
    };
  }>(ADULT_PAGE_QUERY, {
    page: Math.max(1, page),
    perPage: Math.min(Math.max(1, limit), 50),
  });
  const items = data.Page.media ?? [];
  const total = data.Page.pageInfo?.total ?? items.length;
  return { items, total };
}

export async function getAniListByMal(malId: number) {
  const data = await anilistQuery<{ Media: AniListMedia }>(MEDIA_QUERY, {
    idMal: malId,
  });
  return data.Media;
}

export async function getAniListById(id: number) {
  const data = await anilistQuery<{ Media: AniListMedia }>(MEDIA_QUERY, {
    id,
  });
  return data.Media;
}

export async function getAniListExpandedByMal(malId: number) {
  const data = await anilistQuery<{ Media: AniListMediaExpanded }>(
    MEDIA_EXPANDED_QUERY,
    { idMal: malId },
  );
  return data.Media;
}

export async function getAniListExpandedById(id: number) {
  const data = await anilistQuery<{ Media: AniListMediaExpanded }>(
    MEDIA_EXPANDED_QUERY,
    { id },
  );
  return data.Media;
}

export function mapAniListCharacters(media: AniListMediaExpanded) {
  return (media.characters?.edges ?? []).map((edge) => ({
    name: edge.node.name.full,
    image: edge.node.image?.large ?? edge.node.image?.medium,
    role: edge.role,
  }));
}

export function mapAniListRelations(media: AniListMediaExpanded) {
  return (media.relations?.edges ?? []).map((edge) => ({
    title:
      edge.node.title.english ??
      edge.node.title.romaji ??
      "Unknown",
    type: edge.relationType ?? edge.node.type ?? "RELATED",
    id: String(edge.node.idMal ?? edge.node.id),
  }));
}

export function mapAniListRecommendations(media: AniListMediaExpanded) {
  return (media.recommendations?.nodes ?? []).map((node) => ({
    title:
      node.mediaRecommendation.title.english ??
      node.mediaRecommendation.title.romaji ??
      "Unknown",
    id: String(
      node.mediaRecommendation.idMal ?? node.mediaRecommendation.id,
    ),
    poster: node.mediaRecommendation.coverImage?.large,
  }));
}

export function mapAniListToItem(media: AniListMedia) {
  return {
    id: String(media.idMal ?? media.id),
    type: "anime" as const,
    title: media.title.romaji ?? media.title.native ?? media.title.english ?? "",
    description: media.description?.replace(/<[^>]+>/g, "") ?? undefined,
    poster: media.coverImage?.large,
    backdrop: media.bannerImage ?? media.coverImage?.extraLarge,
    year: media.startDate?.year,
    rating: media.averageScore ? media.averageScore / 10 : undefined,
    genres: media.genres,
    externalIds: {
      mal: media.idMal ?? undefined,
      anilist: media.id,
    },
    _adultCheck: {
      isAdult: media.isAdult === true,
      genres: media.genres,
      title: [
        media.title.romaji,
        media.title.english,
        media.title.native,
      ]
        .filter(Boolean)
        .join(" "),
      tags: media.isAdult ? ["adult"] : [],
    },
    _raw: media,
  };
}
