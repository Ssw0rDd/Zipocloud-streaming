"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert, RefreshCw, X } from "lucide-react";
import type { UserTier } from "@zipo/shared";
import { Link } from "@/i18n/routing";
import { getOrCreateSessionSeed, obfuscatedAdClass } from "@/lib/ads";

interface AdBlockContextValue {
  adBlockDetected: boolean;
  detectionReady: boolean;
  sessionSeed: string;
  recheck: () => void;
}

const AdBlockContext = createContext<AdBlockContextValue>({
  adBlockDetected: false,
  detectionReady: false,
  sessionSeed: "",
  recheck: () => {},
});

export function useAdBlock() {
  return useContext(AdBlockContext);
}

interface AdBlockProviderProps {
  children: ReactNode;
  userTier: UserTier;
}

const AD_SCRIPT_PROBE =
  "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
const DETECTION_DELAY_MS = 1500;
const SCRIPT_PROBE_TIMEOUT_MS = 3000;

async function runAdBlockDetection(): Promise<boolean> {
  let signals = 0;

  const bait = document.createElement("div");
  bait.className = "adsbox adsbygoogle ad-placement pub_300x250";
  bait.textContent = "\u00a0";
  bait.setAttribute("data-zp", "ad-bait-probe");
  bait.style.cssText =
    "position:absolute;left:-9999px;width:1px;height:1px;pointer-events:none;";
  document.body.appendChild(bait);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const baitStyle = getComputedStyle(bait);
  if (
    bait.offsetHeight === 0 ||
    bait.offsetParent === null ||
    baitStyle.display === "none" ||
    baitStyle.visibility === "hidden"
  ) {
    signals++;
  }
  bait.remove();

  const cssBait = document.createElement("div");
  cssBait.className = "ad-banner adsbygoogle";
  cssBait.setAttribute("data-zp", "css-bait");
  cssBait.style.cssText =
    "position:absolute;left:-9999px;width:300px;height:250px;pointer-events:none;";
  document.body.appendChild(cssBait);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const rect = cssBait.getBoundingClientRect();
  if (rect.height === 0 || rect.width === 0) {
    signals++;
  }
  cssBait.remove();

  const scriptBlocked = await new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (blocked: boolean) => {
      if (settled) return;
      settled = true;
      resolve(blocked);
    };

    const timeout = window.setTimeout(() => finish(false), SCRIPT_PROBE_TIMEOUT_MS);
    const probe = document.createElement("script");
    probe.async = true;
    probe.src = AD_SCRIPT_PROBE;
    probe.onload = () => {
      window.clearTimeout(timeout);
      finish(false);
      probe.remove();
    };
    probe.onerror = () => {
      window.clearTimeout(timeout);
      finish(true);
      probe.remove();
    };
    document.head.appendChild(probe);
  });

  if (scriptBlocked) {
    signals++;
  }

  return signals >= 2;
}

export function AdBlockProvider({ children, userTier }: AdBlockProviderProps) {
  const adsEnabled = process.env.NEXT_PUBLIC_ADS_ENABLED === "true";
  const [adBlockDetected, setAdBlockDetected] = useState(false);
  const [detectionReady, setDetectionReady] = useState(!adsEnabled);
  const [sessionSeed, setSessionSeed] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!adsEnabled) {
      setSessionSeed("");
      setMounted(true);
      setDetectionReady(true);
      setAdBlockDetected(false);
      return;
    }
    setSessionSeed(getOrCreateSessionSeed());
    setMounted(true);
  }, [adsEnabled]);

  const detectAdBlock = useCallback(async () => {
    if (!adsEnabled || userTier === "supporter") {
      setAdBlockDetected(false);
      setDetectionReady(true);
      return;
    }

    setDetectionReady(false);
    try {
      const detected = await runAdBlockDetection();
      setAdBlockDetected(detected);
    } catch {
      setAdBlockDetected(false);
    } finally {
      setDetectionReady(true);
    }
  }, [adsEnabled, userTier]);

  useEffect(() => {
    if (!adsEnabled || userTier === "supporter") {
      setAdBlockDetected(false);
      setDetectionReady(true);
      return;
    }

    const timer = window.setTimeout(() => {
      void detectAdBlock();
    }, DETECTION_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [adsEnabled, detectAdBlock, userTier]);

  return (
    <AdBlockContext.Provider
      value={{ adBlockDetected, detectionReady, sessionSeed, recheck: detectAdBlock }}
    >
      {children}
      {adsEnabled && mounted && sessionSeed ? (
        <div
          data-zp="honey-pot-persistent"
          className={obfuscatedAdClass(sessionSeed, "hp")}
          style={{
            position: "absolute",
            left: -9999,
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
          aria-hidden="true"
        >
          {/* Intentional inert honeypot; Next Link would prefetch and defeat detection. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/ads/click">sponsored</a>
        </div>
      ) : null}
    </AdBlockContext.Provider>
  );
}

/** Soft notice for guests — does not block site navigation */
export function AdBlockGate({
  children,
  userTier,
}: {
  children: ReactNode;
  userTier: UserTier;
}) {
  const t = useTranslations("ads");
  const tc = useTranslations("common");
  const { adBlockDetected, detectionReady, recheck } = useAdBlock();
  const [dismissed, setDismissed] = useState(false);

  const showNotice =
    detectionReady && adBlockDetected && userTier === "guest" && !dismissed;

  return (
    <>
      {children}
      {showNotice && (
        <div
          className="fixed bottom-4 left-4 right-4 z-[5000] mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-zipo-border bg-zipo-elevated p-4 shadow-lg sm:left-auto sm:right-6"
          role="status"
          aria-live="polite"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-zipo-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-zipo-text">{t("adblockSoftTitle")}</p>
            <p className="mt-1 text-xs text-zipo-muted">{t("adblockSoftMessage")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void recheck()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zipo-border px-3 py-1.5 text-xs font-medium text-zipo-text hover:border-zipo-accent/40"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("adblockRetry")}
              </button>
              <Link
                href="/auth/login"
                className="inline-flex items-center rounded-lg bg-zipo-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-zipo-accent-hover"
              >
                {tc("login")}
              </Link>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded p-1 text-zipo-muted hover:bg-white/5 hover:text-zipo-text"
            aria-label={t("adblockDismiss")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );
}

/** Player area — never hard-block playback; optional hint for guests with adblock */
export function AdBlockPlayerGate({
  children,
  userTier,
}: {
  children: ReactNode;
  userTier: UserTier;
}) {
  const t = useTranslations("ads");
  const tc = useTranslations("common");
  const { adBlockDetected, detectionReady } = useAdBlock();
  const [dismissed, setDismissed] = useState(false);

  const showHint =
    detectionReady && adBlockDetected && userTier === "guest" && !dismissed;

  return (
    <div className="relative w-full">
      {showHint && (
        <div
          className="mb-3 flex items-start gap-3 rounded-xl border border-zipo-border bg-zipo-elevated p-3 text-sm"
          role="status"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-zipo-accent" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-zipo-text">{t("adblockSoftTitle")}</p>
            <p className="mt-0.5 text-xs text-zipo-muted">{t("adblockPlayerMessage")}</p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5">
            <Link
              href="/auth/login"
              className="rounded-lg bg-zipo-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-zipo-accent-hover"
            >
              {tc("login")}
            </Link>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded-lg px-2 py-1 text-xs text-zipo-muted hover:text-zipo-text"
            >
              {t("adblockDismiss")}
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
