"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { youtubeEmbedUrl } from "@/lib/enriched-content";
import { TrailerModal } from "@/components/TrailerModal";

export function DetailTrailer({ trailer, title }: { trailer?: string; title?: string }) {
  const t = useTranslations("detail");
  const [open, setOpen] = useState(false);
  const embedUrl = youtubeEmbedUrl(trailer);

  if (!embedUrl || !trailer) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("trailer")}</h2>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative mt-4 aspect-video w-full max-w-3xl overflow-hidden rounded-xl border border-zipo-border bg-zipo-elevated text-left outline-none transition-colors hover:border-zipo-accent focus-visible:ring-2 focus-visible:ring-zipo-accent"
        aria-label={t("trailer")}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-zipo-bg/90 via-zipo-bg/40 to-transparent" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zipo-accent text-white shadow-lg transition-transform group-hover:scale-105">
            <Play className="h-6 w-6 fill-current" aria-hidden="true" />
          </span>
        </span>
      </button>
      <TrailerModal
        open={open}
        onClose={() => setOpen(false)}
        trailer={trailer}
        title={title ?? t("trailer")}
      />
    </section>
  );
}
