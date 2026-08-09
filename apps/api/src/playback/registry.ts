import { authorizedMediaAdapter } from "./adapters/authorized-media";
import { superflixAdapter } from "./adapters/superflix";
import { warezcdnAdapter } from "./adapters/warezcdn";
import { megafrixAdapter } from "./adapters/megafrix";
import {
  twoembedAdapter,
  videasyAdapter,
  vidkingAdapter,
  vidlinkAdapter,
  vidsrcAdapter,
} from "./adapters/documented-embeds";
import type { PlaybackProviderAdapter } from "./types";
import { megaFlixGatewayAdapter } from "./adapters/megaflix-gateway";

export const playbackAdapters: PlaybackProviderAdapter[] = [
  megafrixAdapter,
  megaFlixGatewayAdapter,
  authorizedMediaAdapter,
  superflixAdapter,
  warezcdnAdapter,
  videasyAdapter,
  vidlinkAdapter,
  vidkingAdapter,
  vidsrcAdapter,
  twoembedAdapter,
].sort((a, b) => a.priority - b.priority);

export function getAdapter(id: string): PlaybackProviderAdapter | undefined {
  return playbackAdapters.find((a) => a.id === id);
}
