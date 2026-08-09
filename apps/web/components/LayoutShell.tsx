"use client";

import type { ReactNode } from "react";
import { AdBlockGate } from "@/components/ads";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useAds } from "@/components/ads/AdsContext";
import { NsfwGate } from "@/components/NsfwGate";
import { useTranslations } from "next-intl";

export function LayoutShell({
  children,
  isNsfw = false,
}: {
  children: ReactNode;
  /** Server-derived; only used for NsfwGate auth flow. */
  isNsfw?: boolean;
}) {
  const { userTier } = useAds();
  const t = useTranslations("common");

  return (
    <AdBlockGate userTier={userTier}>
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[300] -translate-y-20 rounded-md bg-zipo-accent px-4 py-2 font-semibold text-[var(--zipo-on-accent)] transition-transform focus:translate-y-0"
      >
        {t("skipToContent")}
      </a>
      <Navbar userTier={userTier} />
      <div id="main-content" tabIndex={-1} className="flex-1 pt-16 outline-none">
        <NsfwGate enabled={isNsfw}>{children}</NsfwGate>
      </div>
      <Footer />
    </AdBlockGate>
  );
}
