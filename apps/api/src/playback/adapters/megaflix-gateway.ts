import { env } from "../../env";
import {
  megaFlixGatewayConfigured,
  resolveMegaFlixGateway,
} from "../../services/megaflix-gateway";
import type { PlaybackProviderAdapter } from "../types";

export const megaFlixGatewayAdapter: PlaybackProviderAdapter = {
  id: "megaflix",
  label: "MegaFlix",
  supportedTypes: ["movie", "series", "anime"],
  priority: -100,
  nativeMedia: true,
  async probe(ctx) {
    if (!env.MEGAFLIX_GATEWAY_ENABLED) {
      return { id: "megaflix", label: "MegaFlix", available: false, error: "disabled" };
    }
    if (!megaFlixGatewayConfigured()) {
      return { id: "megaflix", label: "MegaFlix", available: false, error: "not_configured" };
    }
    try {
      const available = (await resolveMegaFlixGateway(ctx)).length > 0;
      return { id: "megaflix", label: "MegaFlix", available, ...(available ? {} : { error: "source_unavailable" }) };
    } catch {
      return { id: "megaflix", label: "MegaFlix", available: false, error: "gateway_unavailable" };
    }
  },
  async resolve(ctx) {
    try {
      return await resolveMegaFlixGateway(ctx);
    } catch {
      return [];
    }
  },
};
