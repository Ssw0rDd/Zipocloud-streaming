import { env } from "../../env";
import { createCatalogIframeAdapter } from "./superflix";

export const warezcdnAdapter = createCatalogIframeAdapter({
  id: "warezcdn",
  label: "ZiPo · WarezCDN",
  priority: 2,
  enabled: () => env.WAREZCDN_ENABLED,
  baseUrl: () => env.WAREZCDN_BASE_URL,
});
