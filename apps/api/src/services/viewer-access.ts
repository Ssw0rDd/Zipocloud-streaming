import type { ContentItem, ViewerAccess } from "@zipo/shared";

export function viewerAccess(isAdult: boolean, authenticated: boolean): ViewerAccess {
  const requiresLogin = isAdult && !authenticated;
  return {
    authenticated,
    adult: isAdult,
    canView: !requiresLogin,
    requiresLogin,
    ...(requiresLogin ? { reason: "ADULT_LOGIN_REQUIRED" as const } : {}),
  };
}

export function attachViewerAccess<T extends ContentItem>(
  item: T,
  authenticated: boolean,
): T {
  return { ...item, access: viewerAccess(item.isAdult, authenticated) };
}

export function attachViewerAccessList<T extends ContentItem>(
  items: T[],
  authenticated: boolean,
): T[] {
  return items.map((item) => attachViewerAccess(item, authenticated));
}

