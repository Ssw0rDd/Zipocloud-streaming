import type { AggregatorQuery } from "@zipo/shared";
import type { AggregatorContext } from "./types";
import type { ContentType } from "@zipo/shared";

export const AGGREGATOR_DEFAULTS = {
  locale: "pt",
  audioLang: "sub",
  subtitleLang: "pt",
  includePlayback: true,
} as const;

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseBoolean(value: unknown, defaultValue: boolean): boolean {
  if (value == null || value === "") return defaultValue;
  if (typeof value === "boolean") return value;
  const normalized = String(value).toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function mergeAggregatorQuery(
  query: Record<string, unknown>,
): AggregatorQuery {
  return {
    locale: parseOptionalString(query.locale) ?? AGGREGATOR_DEFAULTS.locale,
    audioLang: parseOptionalString(query.audioLang) ?? AGGREGATOR_DEFAULTS.audioLang,
    subtitleLang:
      parseOptionalString(query.subtitleLang) ?? AGGREGATOR_DEFAULTS.subtitleLang,
    includePlayback: parseBoolean(query.includePlayback, AGGREGATOR_DEFAULTS.includePlayback),
    season: parseOptionalNumber(query.season),
    episode:
      parseOptionalNumber(query.episode) ??
      parseOptionalNumber(query.ep),
  };
}

export function buildAggregatorContext(
  type: ContentType,
  id: string,
  query: Record<string, unknown>,
): AggregatorContext {
  const merged = mergeAggregatorQuery(query);
  return {
    type,
    id,
    locale: merged.locale ?? AGGREGATOR_DEFAULTS.locale,
    audioLang: merged.audioLang ?? AGGREGATOR_DEFAULTS.audioLang,
    subtitleLang: merged.subtitleLang ?? AGGREGATOR_DEFAULTS.subtitleLang,
    includePlayback: merged.includePlayback ?? AGGREGATOR_DEFAULTS.includePlayback,
    season: merged.season,
    episode: merged.episode,
  };
}
