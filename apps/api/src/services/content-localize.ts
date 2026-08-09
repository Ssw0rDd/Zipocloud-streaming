import type { ContentItem, ContentType } from "@zipo/shared";
import { normalizeLocale } from "@zipo/shared";
import { env } from "../env";
import type { MappedContentBase } from "../lib/content-mapper";
import { getAniListByMal } from "./anilist";
import {
  fetchWikipediaSummaryByQuery,
  resolveLocalizedMetadata,
} from "./localization";
import { resolveTmdbId } from "./content-id-mapping";
import {
  tmdbFindByImdb,
  tmdbLanguage,
  tmdbLocalizedById,
} from "./tmdb";

type LocalizableItem = MappedContentBase & { _raw?: unknown };

function fallbackLocalization(
  locale: string,
  hasDescription: boolean,
): NonNullable<ContentItem["localization"]> {
  const requestedLocale = tmdbLanguage(locale);
  const english = normalizeLocale(locale) === "en";
  return {
    requestedLocale,
    resolvedTitleLocale: english ? "en-US" : "original",
    resolvedDescriptionLocale: hasDescription ? "original" : undefined,
    titleFallback: !english,
    descriptionFallback: true,
  };
}

async function localizeFromTmdb(
  item: LocalizableItem,
  locale: string,
): Promise<LocalizableItem | null> {
  const token = env.TMDB_ACCESS_TOKEN;
  if (!token) return null;
  const imdbId =
    item.externalIds?.imdb ?? (item.id.startsWith("tt") ? item.id : undefined);

  const localized =
    item.type === "movie" || item.type === "series"
      ? imdbId
        ? await tmdbFindByImdb(imdbId, locale, token, item.type)
        : item.externalIds?.tmdb
          ? await tmdbLocalizedById(
              item.type === "movie" ? "movie" : "tv",
              item.externalIds.tmdb,
              locale,
              token,
            )
          : null
      : await (async () => {
          const tmdbId =
            item.externalIds?.tmdb ??
            (await resolveTmdbId({
              type: "anime",
              id: item.id,
              title: item.originalTitle ?? item.title,
              year: item.year,
            }));
          return tmdbId
            ? tmdbLocalizedById("tv", tmdbId, locale, token)
            : null;
        })();

  if (!localized) return null;
  return {
    ...item,
    title: localized.title,
    originalTitle: localized.originalTitle || item.originalTitle || item.title,
    description: localized.overview ?? item.description,
    externalIds: { ...item.externalIds, tmdb: localized.tmdbId },
    localization: {
      requestedLocale: tmdbLanguage(locale),
      resolvedTitleLocale: localized.resolvedTitleLocale,
      resolvedDescriptionLocale: localized.resolvedDescriptionLocale,
      titleFallback: localized.titleFallback,
      descriptionFallback: localized.descriptionFallback,
    },
  };
}

export async function localizeMappedItem(
  item: LocalizableItem,
  locale: string,
): Promise<LocalizableItem> {
  const originalTitle = item.originalTitle ?? item.title;
  const tmdb = await localizeFromTmdb(
    { ...item, originalTitle },
    locale,
  ).catch(() => null);
  if (tmdb) return tmdb;

  if (item.type === "anime") {
    let title = item.title;
    try {
      const anilist = await getAniListByMal(Number(item.id));
      title = pickAnimeTitle(anilist.title, locale) || title;
    } catch {
      // Existing catalog title remains the fail-safe.
    }
    let description = item.description;
    if (normalizeLocale(locale) !== "en") {
      const wiki = await fetchWikipediaSummaryByQuery(title, locale);
      description = wiki?.text ?? description;
    }
    return {
      ...item,
      title,
      originalTitle,
      description,
      localization: fallbackLocalization(locale, Boolean(description)),
    };
  }

  const imdbId =
    item.externalIds?.imdb ?? (item.id.startsWith("tt") ? item.id : undefined);
  const fallback = await resolveLocalizedMetadata({
    locale,
    title: item.title,
    year: item.year,
    type: item.type as "movie" | "series",
    imdbId,
    originalDescription: item.description,
    traktClientId: env.TRAKT_CLIENT_ID,
    omdbApiKey: env.OMDB_API_KEY,
  });
  return {
    ...item,
    title: fallback.title ?? item.title,
    originalTitle,
    description: fallback.description?.text ?? item.description,
    localization: fallbackLocalization(
      locale,
      Boolean(fallback.description?.text ?? item.description),
    ),
  };
}

export async function localizeMappedItems(
  items: LocalizableItem[],
  locale: string,
): Promise<LocalizableItem[]> {
  const result: LocalizableItem[] = [];
  for (let i = 0; i < items.length; i += 5) {
    result.push(
      ...(await Promise.all(
        items.slice(i, i + 5).map((item) => localizeMappedItem(item, locale)),
      )),
    );
  }
  return result;
}

export async function localizeContentItem(
  item: ContentItem,
  locale: string,
): Promise<ContentItem> {
  const localized = await localizeMappedItem(
    {
      id: item.id,
      type: item.type,
      title: item.title,
      originalTitle: item.originalTitle,
      description: item.description,
      poster: item.poster,
      backdrop: item.backdrop,
      year: item.year,
      rating: item.rating,
      genres: item.genres,
      externalIds: item.externalIds,
      localization: item.localization,
      playbackAvailability: item.playbackAvailability,
      playbackAccess: item.playbackAccess,
    },
    locale,
  );
  return { ...item, ...localized };
}

export async function localizeContentItems(
  items: ContentItem[],
  locale: string,
): Promise<ContentItem[]> {
  const result: ContentItem[] = [];
  for (let i = 0; i < items.length; i += 5) {
    result.push(
      ...(await Promise.all(
        items.slice(i, i + 5).map((item) => localizeContentItem(item, locale)),
      )),
    );
  }
  return result;
}

export function localeToWikiLang(locale: string): string {
  return tmdbLanguage(locale).split("-")[0] ?? "en";
}

export function pickAnimeTitle(
  titles: { romaji?: string; english?: string; native?: string },
  locale: string,
): string {
  const base = normalizeLocale(locale);
  if (base === "ja") return titles.native ?? titles.romaji ?? titles.english ?? "";
  return titles.english ?? titles.romaji ?? titles.native ?? "";
}

export function mapAnimeWithLocale<T extends ContentItem>(
  item: T,
  locale: string,
  anilistTitles?: { romaji?: string; english?: string; native?: string },
): T {
  if (!anilistTitles) return item;
  const title = pickAnimeTitle(anilistTitles, locale);
  return title ? { ...item, title } : item;
}

export type { ContentType };
