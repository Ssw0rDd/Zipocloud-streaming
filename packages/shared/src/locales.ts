export const LOCALE_REGISTRY = {
  pt: { tmdb: "pt-BR", nativeName: "Português" },
  en: { tmdb: "en-US", nativeName: "English" },
  es: { tmdb: "es-ES", nativeName: "Español" },
  fr: { tmdb: "fr-FR", nativeName: "Français" },
  de: { tmdb: "de-DE", nativeName: "Deutsch" },
  it: { tmdb: "it-IT", nativeName: "Italiano" },
  ja: { tmdb: "ja-JP", nativeName: "日本語" },
  ko: { tmdb: "ko-KR", nativeName: "한국어" },
  zh: { tmdb: "zh-CN", nativeName: "中文" },
} as const;

export type SupportedLocale = keyof typeof LOCALE_REGISTRY;
export const SUPPORTED_LOCALES = Object.keys(LOCALE_REGISTRY) as SupportedLocale[];

export function normalizeLocale(locale?: string): SupportedLocale {
  const base = locale?.split("-")[0]?.toLowerCase();
  return base && base in LOCALE_REGISTRY ? (base as SupportedLocale) : "en";
}

export function toTmdbLocale(locale?: string): string {
  return LOCALE_REGISTRY[normalizeLocale(locale)].tmdb;
}
