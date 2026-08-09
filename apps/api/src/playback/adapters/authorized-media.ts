import { env } from "../../env";
import {
  authorizedMediaConfigured,
  authorizedMediaOrigins,
  resolveAuthorizedMedia,
} from "../../services/authorized-media";
import type { PlaybackProviderAdapter } from "../types";

export const authorizedMediaAdapter: PlaybackProviderAdapter = {
  id: "authorized-media",
  label: "ZiPo",
  supportedTypes: ["movie", "series", "anime"],
  priority: 0,
  nativeMedia: true,
  mediaOrigins: authorizedMediaOrigins,
  async probe(ctx) {
    if (!env.AUTHORIZED_MEDIA_ENABLED) {
      return {
        id: "authorized-media",
        label: "ZiPo",
        available: false,
        error: "disabled",
      };
    }
    if (!authorizedMediaConfigured()) {
      return {
        id: "authorized-media",
        label: "ZiPo",
        available: false,
        error: "not_configured",
      };
    }
    try {
      const available = (await resolveAuthorizedMedia(ctx)).length > 0;
      return {
        id: "authorized-media",
        label: "ZiPo",
        available,
        ...(available ? {} : { error: "source_unavailable" }),
      };
    } catch {
      return {
        id: "authorized-media",
        label: "ZiPo",
        available: false,
        error: "resolver_unavailable",
      };
    }
  },
  async resolve(ctx) {
    if (!authorizedMediaConfigured()) return [];
    try {
      return await resolveAuthorizedMedia(ctx);
    } catch {
      return [];
    }
  },
};
