"use client";

import { useEffect, useRef, type RefObject } from "react";

export function isAnime4KSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "gpu" in navigator &&
    typeof HTMLCanvasElement !== "undefined"
  );
}

export function useAnime4K(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  active: boolean,
) {
  const runningRef = useRef(false);

  useEffect(() => {
    if (!enabled || !active) {
      runningRef.current = false;
      return;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !isAnime4KSupported()) return;

    let cancelled = false;
    runningRef.current = true;

    const syncCanvasSize = () => {
      const w = video.clientWidth || video.videoWidth || 1280;
      const h = video.clientHeight || video.videoHeight || 720;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    const onMeta = () => syncCanvasSize();
    video.addEventListener("loadedmetadata", onMeta);
    syncCanvasSize();

    void (async () => {
      try {
        const { CNNx2UL, GANUUL, render } = await import("anime4k-webgpu");
        if (cancelled || !runningRef.current) return;

        await render({
          video,
          canvas,
          pipelineBuilder: (device, inputTexture) => {
            const upscale = new CNNx2UL({ device, inputTexture });
            const restore = new GANUUL({
              device,
              inputTexture: upscale.getOutputTexture(),
            });
            return [upscale, restore];
          },
        });
      } catch {
        runningRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
      runningRef.current = false;
      video.removeEventListener("loadedmetadata", onMeta);
    };
  }, [enabled, active, videoRef, canvasRef]);
}
