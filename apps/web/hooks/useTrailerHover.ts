"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentType } from "@/lib/api";
import { fetchTrailer } from "@/lib/enriched-content";

const HOVER_DELAY_MS = 5000;
const trailerCache = new Map<string, string | null>();

function cacheKey(type: ContentType, id: string) {
  return `${type}:${id}`;
}

export function useTrailerHover(
  type: ContentType,
  id: string,
  initialTrailer?: string,
) {
  const key = cacheKey(type, id);
  const [trailer, setTrailer] = useState<string | undefined>(
    initialTrailer ?? trailerCache.get(key) ?? undefined,
  );
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolveTrailer = useCallback(async (): Promise<string | undefined> => {
    if (trailer) return trailer;
    if (trailerCache.has(key)) {
      const cached = trailerCache.get(key);
      if (cached) setTrailer(cached);
      return cached ?? undefined;
    }

    setLoading(true);
    try {
      const result = await fetchTrailer(type, id);
      const url = result.trailer ?? null;
      trailerCache.set(key, url);
      if (url) setTrailer(url);
      return url ?? undefined;
    } catch {
      trailerCache.set(key, null);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [trailer, key, type, id]);

  const clearHoverTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    clearHoverTimer();
    timerRef.current = setTimeout(async () => {
      const resolved = await resolveTrailer();
      if (resolved) setShowPreview(true);
    }, HOVER_DELAY_MS);
  }, [clearHoverTimer, resolveTrailer]);

  const onMouseLeave = useCallback(() => {
    clearHoverTimer();
    setShowPreview(false);
  }, [clearHoverTimer]);

  useEffect(() => () => clearHoverTimer(), [clearHoverTimer]);

  return {
    trailer,
    showPreview,
    loading,
    onMouseEnter,
    onMouseLeave,
    resolveTrailer,
  };
}
