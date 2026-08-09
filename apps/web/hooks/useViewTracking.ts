"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ContentType } from "@zipo/shared";
import { recordView } from "@/lib/api";

interface UseViewTrackingOptions {
  contentType: ContentType;
  contentId: string;
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  progressSeconds?: number;
  durationSeconds?: number;
  enabled?: boolean;
}

interface ProgressSnapshot extends Required<Pick<UseViewTrackingOptions,
  "contentType" | "contentId" | "progressSeconds" | "durationSeconds" | "enabled"
>> {
  episodeId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

function persistSnapshot(
  snapshot: ProgressSnapshot,
  options?: { completed?: boolean; keepalive?: boolean; allowZero?: boolean },
): void {
  if (!snapshot.enabled) return;
  if (!options?.allowZero && snapshot.progressSeconds < 1 && !options?.completed) return;
  void recordView(
    {
      contentType: snapshot.contentType,
      contentId: snapshot.contentId,
      episodeId: snapshot.episodeId,
      seasonNumber: snapshot.seasonNumber,
      episodeNumber: snapshot.episodeNumber,
      progressSeconds: Math.max(0, Math.floor(snapshot.progressSeconds)),
      durationSeconds:
        snapshot.durationSeconds > 0
          ? Math.floor(snapshot.durationSeconds)
          : undefined,
      completed: options?.completed,
    },
    { keepalive: options?.keepalive },
  ).catch(() => {
    /* playback must continue if progress persistence is unavailable */
  });
}

export function useViewTracking({
  contentType,
  contentId,
  episodeId,
  seasonNumber,
  episodeNumber,
  progressSeconds = 0,
  durationSeconds = 0,
  enabled = true,
}: UseViewTrackingOptions) {
  const identity = `${contentType}:${contentId}:${episodeId ?? "movie"}`;
  const snapshotRef = useRef<ProgressSnapshot>({
    contentType,
    contentId,
    episodeId,
    seasonNumber,
    episodeNumber,
    progressSeconds,
    durationSeconds,
    enabled,
  });
  const identityRef = useRef(identity);
  const lastSentProgressRef = useRef(0);
  const lastSentAtRef = useRef(0);

  useEffect(() => {
    if (identityRef.current !== identity) {
      persistSnapshot(snapshotRef.current, { keepalive: true });
      identityRef.current = identity;
      lastSentProgressRef.current = 0;
      lastSentAtRef.current = 0;
    }
  }, [identity]);

  useEffect(() => {
    snapshotRef.current = {
      contentType,
      contentId,
      episodeId,
      seasonNumber,
      episodeNumber,
      progressSeconds,
      durationSeconds,
      enabled,
    };
  }, [
    contentType,
    contentId,
    episodeId,
    seasonNumber,
    episodeNumber,
    progressSeconds,
    durationSeconds,
    enabled,
  ]);

  useEffect(() => {
    if (!enabled || progressSeconds < 10) return;
    const now = Date.now();
    const firstSave = lastSentAtRef.current === 0;
    const progressedEnough = progressSeconds - lastSentProgressRef.current >= 15;
    const elapsedEnough = now - lastSentAtRef.current >= 12_000;
    if (!firstSave && (!progressedEnough || !elapsedEnough)) return;
    persistSnapshot(snapshotRef.current);
    lastSentProgressRef.current = progressSeconds;
    lastSentAtRef.current = now;
  }, [enabled, progressSeconds]);

  const flushProgress = useCallback(() => {
    persistSnapshot(snapshotRef.current, { keepalive: true });
  }, []);

  const markCompleted = useCallback(() => {
    persistSnapshot(snapshotRef.current, { completed: true, keepalive: true });
  }, []);

  const resetProgress = useCallback(() => {
    const snapshot = { ...snapshotRef.current, progressSeconds: 0 };
    snapshotRef.current = snapshot;
    persistSnapshot(snapshot, { keepalive: true, allowZero: true });
  }, []);

  useEffect(() => {
    const saveOnExit = () => persistSnapshot(snapshotRef.current, { keepalive: true });
    const saveWhenHidden = () => {
      if (document.visibilityState === "hidden") saveOnExit();
    };
    window.addEventListener("pagehide", saveOnExit);
    document.addEventListener("visibilitychange", saveWhenHidden);
    return () => {
      window.removeEventListener("pagehide", saveOnExit);
      document.removeEventListener("visibilitychange", saveWhenHidden);
      saveOnExit();
    };
  }, []);

  return { flushProgress, markCompleted, resetProgress };
}
