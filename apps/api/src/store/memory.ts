import type { Clip, Comment, ContentType, ReactionValue } from "@zipo/shared";

export interface StoredReaction {
  userId?: string;
  sessionId?: string;
  contentType: ContentType;
  contentId: string;
  reaction: ReactionValue;
}

export interface AppStore {
  comments: Map<string, Comment>;
  clips: Map<string, Clip>;
  clipsPerUserPerDay: Map<string, number>;
  impressions: Array<Record<string, unknown>>;
  reactions: Map<string, StoredReaction>;
}

export function createStore(): AppStore {
  return {
    comments: new Map(),
    clips: new Map(),
    clipsPerUserPerDay: new Map(),
    impressions: [],
    reactions: new Map(),
  };
}

export function getClipsDayKey(userId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${userId}:${today}`;
}
