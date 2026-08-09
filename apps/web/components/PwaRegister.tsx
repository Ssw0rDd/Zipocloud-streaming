"use client";

import { useEffect } from "react";

/**
 * Registers the shell-only service worker when NEXT_PUBLIC_PWA_ENABLED=true.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PWA_ENABLED !== "true") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* non-blocking */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
