import type {
  LegacyContentItem as ContentItem,
  LegacyContentDetail as ContentDetail,
  ContentType,
} from "@zipo/shared";

export const MOCK_CATALOG: ContentItem[] = [
  {
    id: "tt0111161",
    type: "movie",
    title: "The Shawshank Redemption",
    genres: ["drama"],
    year: 1994,
    isFeatured: true,
    isAdult: false,
  },
  {
    id: "12345",
    type: "anime",
    title: "Adult Anime Sample",
    genres: ["hentai", "anime"],
    year: 2020,
    isAdult: true,
  },
  {
    id: "tt0903747",
    type: "series",
    title: "Breaking Bad",
    genres: ["drama", "crime"],
    year: 2008,
    isAdult: false,
  },
];

export function getContentById(
  type: ContentType,
  id: string,
): ContentDetail | undefined {
  const item = MOCK_CATALOG.find((c) => c.type === type && c.id === id);
  if (!item) return undefined;
  return {
    ...item,
    embedUrl: `https://cdn.example.com/embed/${type}/${id}`,
    description: `Description for ${item.title}`,
  };
}

export function searchCatalog(query: string): ContentItem[] {
  const q = query.toLowerCase();
  return MOCK_CATALOG.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.genres?.some((g) => g.toLowerCase().includes(q)),
  );
}
