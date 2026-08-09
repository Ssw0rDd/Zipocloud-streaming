import {
  itemAllowedForSite,
  resolveSiteMode,
  SITE_MODE_HEADER,
  type SiteMode,
} from "@zipo/shared";
import { env } from "../env";
import { getSession } from "../auth";

export function siteModeFromRequest(request: Request): SiteMode {
  return resolveSiteMode({
    header: request.headers.get(SITE_MODE_HEADER),
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    nsfwFrontendUrl: env.NSFW_FRONTEND_URL,
  });
}

export type NsfwAccess =
  | { ok: true; mode: SiteMode; userId?: string }
  | { ok: false; status: 401 | 403; code: string; error: string };

/** NSFW site requires login + age confirmation. Main always ok. */
export async function assertSiteAccess(request: Request): Promise<NsfwAccess> {
  const mode = siteModeFromRequest(request);
  const session = await getSession(request).catch(() => null);
  const user = session?.user as
    | { id: string; adultConfirmedAt?: Date | string | null }
    | undefined;

  if (mode === "main") {
    return { ok: true, mode, userId: user?.id };
  }

  if (!user) {
    return {
      ok: false,
      status: 401,
      code: "NSFW_LOGIN_REQUIRED",
      error: "Login necessário para o site NSFW",
    };
  }

  if (!Boolean(user.adultConfirmedAt)) {
    return {
      ok: false,
      status: 403,
      code: "ADULT_CONFIRMATION_REQUIRED",
      error: "Confirme que você tem 18 anos ou mais",
    };
  }

  return { ok: true, mode, userId: user.id };
}

export function isUserAdultConfirmed(
  user: { adultConfirmedAt?: Date | string | null } | null | undefined,
): boolean {
  return Boolean(user?.adultConfirmedAt);
}

export type SiteContentGate =
  | { ok: true }
  | { ok: false; status: 404; code: "SITE_CONTENT_BLOCKED"; error: string };

/** After assertSiteAccess, reject items that do not belong on this site. */
export function assertItemForSite(
  item: { isAdult: boolean },
  mode: SiteMode,
): SiteContentGate {
  if (!itemAllowedForSite(item, mode)) {
    return {
      ok: false,
      status: 404,
      code: "SITE_CONTENT_BLOCKED",
      error: "Conteúdo não disponível neste site",
    };
  }
  return { ok: true };
}
