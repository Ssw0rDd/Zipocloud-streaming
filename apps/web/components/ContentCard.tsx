"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play, ShieldAlert, Star, Volume2, VolumeX } from "lucide-react";
import { Link, useRouter } from "@/i18n/routing";
import type { ContentItem } from "@/lib/api";
import { getPosterUrl } from "@/lib/api";
import { cn, formatRating } from "@/lib/utils";
import { youtubePreviewEmbedUrl } from "@/lib/enriched-content";
import { useTrailerHover } from "@/hooks/useTrailerHover";
import { TrailerModal } from "./TrailerModal";
import { ResilientImage } from "./ResilientImage";

interface ContentCardProps {
  item: ContentItem;
  priority?: boolean;
  index?: number;
  trailer?: string;
  onOpen?: () => void;
}


export function ContentCard({
  item,
  priority = false,
  trailer: initialTrailer,
  onOpen,
}: ContentCardProps) {
  const t = useTranslations("common");
  const router = useRouter();
  const [revealed, setRevealed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTrailer, setModalTrailer] = useState<string | undefined>();
  const [previewMuted, setPreviewMuted] = useState(true);
  const href = `/${item.type}/${item.id}`;
  const adultBlocked = item.isAdult && item.access?.canView !== true;

  const {
    trailer,
    showPreview,
    onMouseEnter,
    onMouseLeave,
    resolveTrailer,
  } = useTrailerHover(item.type, item.id, initialTrailer);

  const previewUrl = showPreview && !adultBlocked ? youtubePreviewEmbedUrl(trailer, { mute: previewMuted }) : undefined;

  const handleTrailerClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const resolved = trailer ?? (await resolveTrailer());
    if (resolved) {
      setModalTrailer(resolved);
      setModalOpen(true);
    }
  };

  return (
    <>
      <div className="group" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        <Link href={href} className="block" aria-label={item.title} onClick={onOpen}>
          <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-zipo-surface surface-card">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                title={t("trailerPreview", { title: item.title })}
                className="absolute inset-0 z-[1] h-full w-full object-cover"
                allow="autoplay; encrypted-media; picture-in-picture"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <ResilientImage
                candidates={[getPosterUrl(item), ...(item.posterCandidates ?? [])]}
                alt={item.title}
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                priority={priority}
                quality={90}
                className={cn(
                  "object-contain transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] group-hover:scale-[1.025]",
                  adultBlocked && !revealed && "adult-blur",
                )}
                placeholderLabel={item.title}
              />
            )}

            {adultBlocked && !revealed && (
              <div
                className="absolute inset-0 z-10 flex min-h-[44px] flex-col items-center justify-center bg-zipo-bg/80 p-4 text-center"
                onClick={(e) => {
                  e.preventDefault();
                  if (item.access?.requiresLogin) router.push("/auth/login");
                  else setRevealed(true);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    if (item.access?.requiresLogin) router.push("/auth/login");
                    else setRevealed(true);
                  }
                }}
                aria-label={t("revealContent")}
              >
                <ShieldAlert className="mb-2 h-6 w-6 text-zipo-accent" aria-hidden="true" />
                <span className="text-xs font-medium text-zipo-text">
                  {t("sensitiveContent")}
                </span>
                <span className="mt-1 text-xs text-zipo-muted">
                  {item.access?.requiresLogin ? t("login") : t("revealContent")}
                </span>
              </div>
            )}

            {item.rating && (
              <div className="absolute right-2 top-2 z-[2] flex items-center gap-0.5 rounded-md bg-zipo-bg/90 px-1.5 py-0.5 text-xs font-medium text-zipo-text-secondary">
                <Star className="h-3 w-3 fill-zipo-accent text-zipo-accent" aria-hidden="true" />
                {formatRating(item.rating)}
              </div>
            )}

            {previewUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPreviewMuted((m) => !m);
                }}
                className="absolute right-2 bottom-2 z-[4] flex h-8 w-8 items-center justify-center rounded-full bg-zipo-bg/90 text-zipo-text shadow-md transition hover:bg-zipo-elevated"
                aria-label={previewMuted ? t("unmuteTrailer") : t("muteTrailer")}
              >
                {previewMuted ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleTrailerClick}
              className={cn(
                "absolute bottom-2 left-2 z-[3] flex h-9 w-9 items-center justify-center rounded-full bg-zipo-bg/90 text-zipo-accent shadow-[0_2px_8px_var(--zipo-shadow)] transition-[opacity,transform,background-color,color] duration-200",
                "opacity-0 group-hover:opacity-100 hover:scale-105 hover:bg-zipo-elevated hover:text-zipo-accent-hover",
                trailer && "opacity-100",
              )}
              aria-label={t("playTrailer")}
              title={t("playTrailer")}
            >
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            </button>

            {item.description && !showPreview && (
              <div className="absolute inset-x-0 bottom-0 z-[2] translate-y-1 bg-gradient-to-t from-zipo-bg/95 via-zipo-bg/60 to-transparent p-3 pt-8 opacity-0 transition-[opacity,transform] duration-250 group-hover:translate-y-0 group-hover:opacity-100">
                <p className="line-clamp-2 text-xs leading-relaxed text-zipo-text-secondary">
                  {item.description}
                </p>
              </div>
            )}
          </div>

          <h3 className="mt-3 truncate text-sm font-semibold tracking-[-0.01em] text-zipo-text transition-colors duration-200 group-hover:text-zipo-accent">
            {item.title}
          </h3>
          {item.year && (
            <p className="mt-0.5 text-xs text-zipo-muted">{item.year}</p>
          )}
        </Link>
      </div>

      {modalTrailer && (
        <TrailerModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          trailer={modalTrailer}
          title={item.title}
        />
      )}
    </>
  );
}
