"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowRight, EyeOff, Loader2 } from "lucide-react";
import { Link } from "@/i18n/routing";
import {
  getBackdropUrl,
  getPosterUrl,
  recordRecommendationEvent,
  submitRecommendationFeedback,
  type ContentItem,
} from "@/lib/api";
import { isNsfwSite } from "@/lib/site-mode";
import { ContentCard } from "./ContentCard";
import { ResilientImage } from "./ResilientImage";

interface ContentRowProps {
  title: string;
  items: ContentItem[];
  seeAllHref?: string;
  ranked?: boolean;
  recommendationRail?: string;
  reasons?: Record<string, string>;
  feedbackEnabled?: boolean;
}

function RecommendationCard({
  item,
  index,
  rail,
  reason,
  feedbackEnabled,
}: {
  item: ContentItem;
  index: number;
  rail: string;
  reason?: string;
  feedbackEnabled: boolean;
}) {
  const t = useTranslations("home");
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const sentRef = useRef(false);
  const [hidden, setHidden] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || sentRef.current || typeof IntersectionObserver === "undefined") return;
    let timer: number | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
        timer = window.setTimeout(() => {
          if (sentRef.current) return;
          sentRef.current = true;
          void recordRecommendationEvent({ eventType: "impression", contentType: item.type, contentId: item.id, rail, position: index }).catch(() => undefined);
          observer.disconnect();
        }, 800);
      } else if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => { if (timer != null) window.clearTimeout(timer); observer.disconnect(); };
  }, [index, item.id, item.type, rail]);

  if (hidden) return null;
  return (
    <div ref={rootRef}>
      <ContentCard
        item={item}
        index={index}
        onOpen={() => void recordRecommendationEvent({ eventType: "detail", contentType: item.type, contentId: item.id, rail, position: index }).catch(() => undefined)}
      />
      {reason && <p className="mt-1.5 line-clamp-1 text-[11px] text-zipo-muted">{reason}</p>}
      {feedbackEnabled && (
        <button
          type="button"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              await submitRecommendationFeedback({ contentType: item.type, contentId: item.id, action: "not_for_me" });
              setHidden(true);
              void queryClient.invalidateQueries({ queryKey: ["home", "personalized"] });
            } catch {
              // Keep the card visible when feedback could not be persisted.
            } finally {
              setSubmitting(false);
            }
          }}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md text-[11px] text-zipo-muted transition hover:text-zipo-text disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
          {t("notForMe")}
        </button>
      )}
    </div>
  );
}

function RankedContentCard({ item, index }: { item: ContentItem; index: number }) {
  return (
    <Link
      href={`/${item.type}/${item.id}`}
      className="nsfw-ranked-card group relative block w-[min(88vw,20rem)] shrink-0 sm:w-[22rem]"
      aria-label={item.title}
    >
      <div className="relative flex overflow-hidden rounded-2xl border border-zipo-border-subtle bg-zipo-elevated shadow-sm transition duration-300 group-hover:border-zipo-accent/35 group-hover:shadow-[0_12px_28px_var(--zipo-shadow-hover)]">
        <div className="relative aspect-[2/3] w-[42%] shrink-0 bg-zipo-surface">
          <ResilientImage
            candidates={[getPosterUrl(item), ...(item.posterCandidates ?? []), getBackdropUrl(item)]}
            alt={item.title}
            sizes="(max-width: 640px) 38vw, 150px"
            quality={90}
            className="object-contain transition duration-500 group-hover:scale-[1.02]"
            placeholderLabel={item.title}
          />
        </div>
        <div className="relative flex min-w-0 flex-1 flex-col justify-between p-4 sm:p-5">
          <span className="font-display text-4xl font-semibold leading-none tracking-[-0.06em] text-zipo-accent sm:text-5xl">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-base font-semibold leading-snug text-zipo-text sm:text-lg">
              {item.title}
            </h3>
            <p className="mt-1.5 text-xs text-zipo-muted sm:text-sm">
              {[item.year, item.type === "movie" ? "Filme" : item.type === "series" ? "Série" : "Anime"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ContentRow({
  title,
  items,
  seeAllHref,
  ranked = false,
  recommendationRail,
  reasons,
  feedbackEnabled = false,
}: ContentRowProps) {
  const t = useTranslations("common");
  const nsfw = isNsfwSite();

  return (
    <section className={nsfw ? "nsfw-content-row py-10 sm:py-14" : "zipo-content-row py-9 sm:py-12"}>
      <div className={nsfw ? "mb-6 flex items-center justify-between gap-4" : "mb-4 flex items-center justify-between gap-4 sm:mb-5"}>
        <h2 className={nsfw ? "nsfw-section-title text-2xl font-semibold tracking-[-0.03em] text-zipo-text sm:text-3xl" : "text-xl font-semibold tracking-[-0.025em] text-zipo-text sm:text-2xl"}>
          {title}
        </h2>
        {seeAllHref && (
          <Link
            href={seeAllHref}
            className={nsfw ? "inline-flex min-h-11 shrink-0 items-center gap-2 text-sm font-medium text-zipo-accent transition-colors hover:text-zipo-accent-hover" : "inline-flex min-h-[44px] shrink-0 items-center gap-1 text-sm font-medium text-zipo-muted transition-colors duration-200 hover:text-zipo-accent"}
          >
            {t("seeAll")}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <div
        className={
          nsfw
            ? "-mx-4 flex gap-4 overflow-x-auto px-4 pb-3 [scrollbar-width:thin] sm:-mx-6 sm:gap-5 sm:px-6"
            : "-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:thin] sm:-mx-6 sm:px-6"
        }
      >
        {items.map((item, i) =>
          ranked ? (
            <RankedContentCard key={item.id} item={item} index={i} />
          ) : (
            <div
              key={item.id}
              className={nsfw ? "w-[160px] shrink-0 sm:w-[190px] xl:w-[210px]" : "w-[150px] shrink-0 sm:w-[180px] xl:w-[196px]"}
            >
              {recommendationRail ? (
                <RecommendationCard
                  item={item}
                  index={i}
                  rail={recommendationRail}
                  reason={reasons?.[`${item.type}:${item.id}`]}
                  feedbackEnabled={feedbackEnabled}
                />
              ) : (
                <ContentCard item={item} index={i} />
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in-up">{children}</div>;
}
