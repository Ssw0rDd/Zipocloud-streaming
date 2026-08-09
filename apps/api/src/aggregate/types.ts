import type { ContentType } from "@zipo/shared";

export interface AggregatorContext {
  type: ContentType;
  id: string;
  locale: string;
  audioLang: string;
  subtitleLang: string;
  includePlayback: boolean;
  season?: number;
  episode?: number;
}
