import { parseSiteMode, SITE_MODE_HEADER, type SiteMode } from "@zipo/shared";

export function getSiteMode(): SiteMode {
  return parseSiteMode(process.env.NEXT_PUBLIC_SITE_MODE) ?? "main";
}

export function isNsfwSite(): boolean {
  return getSiteMode() === "nsfw";
}

export function siteModeHeaders(): Record<string, string> {
  return { [SITE_MODE_HEADER]: getSiteMode() };
}

export function siteDisplayName(): string {
  return process.env.NEXT_PUBLIC_SITE_NAME?.trim() || (isNsfwSite() ? "ZiPo NSFW" : "ZiPo");
}
