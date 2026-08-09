import type { ContentType } from "./constants";

export const ID_PATTERNS = {
  imdb: /^tt\d{7,8}$/,
  tvmaze: /^\d{1,10}$/,
  mal: /^\d{1,8}$/,
  anilist: /^\d{1,8}$/,
  generic: /^[a-zA-Z0-9_-]{1,64}$/,
} as const;

export function isValidContentId(type: ContentType | string, id: string): boolean {
  switch (type) {
    case "movie":
    case "series":
      return ID_PATTERNS.imdb.test(id) || ID_PATTERNS.tvmaze.test(id);
    case "anime":
      return (
        ID_PATTERNS.mal.test(id) ||
        ID_PATTERNS.anilist.test(id) ||
        ID_PATTERNS.generic.test(id)
      );
    default:
      return ID_PATTERNS.generic.test(id);
  }
}
