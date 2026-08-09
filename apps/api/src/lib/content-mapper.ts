import { canonicalizeGenres, imageCandidates, type ContentItem } from "@zipo/shared";
import type { AdultCheckInput } from "../services/adult-filter";
import { detectAdultContent } from "../services/adult-filter";

export interface MappedContentBase {
  id: string;
  type: ContentItem["type"];
  title: string;
  originalTitle?: string;
  description?: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  rating?: number;
  genres?: string[];
  externalIds?: ContentItem["externalIds"];
  localization?: ContentItem["localization"];
  playbackAvailability?: ContentItem["playbackAvailability"];
  playbackAccess?: ContentItem["playbackAccess"];
  _adultCheck?: AdultCheckInput;
}

export function finalizeItem(
  item: MappedContentBase & { _raw?: unknown },
): ContentItem {
  const { _adultCheck, _raw: _omitRaw, ...rest } = item;
  return {
    ...rest,
    genres: canonicalizeGenres(rest.genres),
    posterCandidates: imageCandidates(rest.poster, rest.backdrop),
    stillCandidates: imageCandidates(rest.backdrop, rest.poster),
    isAdult: detectAdultContent(_adultCheck ?? {}),
  };
}
