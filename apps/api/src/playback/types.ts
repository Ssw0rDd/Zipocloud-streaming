import type { ContentType, EmbedSource, PlaybackProviderInfo } from "@zipo/shared";

export interface PlaybackContext {
  type: ContentType;
  id: string;
  season?: number;
  episode?: number;
  audioLang?: string;
  subtitleLang?: string;
  title?: string;
  alternativeTitles?: string[];
  year?: number;
  imdbId?: string;
  tmdbId?: number;
  episodeTitle?: string;
  episodeAirDate?: string;
}

export interface ProviderProbeResult {
  id: string;
  label: string;
  available: boolean;
  latencyMs?: number;
  error?: string;
}

export interface PlaybackProviderAdapter {
  id: string;
  label: string;
  supportedTypes: ContentType[];
  priority: number;
  nativeMedia?: boolean;
  /** Exact HTTPS origins this adapter may expose to the media worker. */
  mediaOrigins?: () => string[];
  probe(ctx: PlaybackContext): Promise<ProviderProbeResult>;
  resolve(ctx: PlaybackContext): Promise<EmbedSource[]>;
}

export interface DiscoverResult {
  providers: PlaybackProviderInfo[];
  sources: EmbedSource[];
}
