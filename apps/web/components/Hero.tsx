"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Play, Info, Star } from "lucide-react";
import { Link } from "@/i18n/routing";
import type { ContentItem } from "@/lib/api";
import { getBackdropUrl } from "@/lib/api";
import { isNsfwSite } from "@/lib/site-mode";
import { watchEpisodeQuery } from "@/lib/watch-episode";
import { ResilientImage } from "./ResilientImage";

interface HeroProps {
  featured?: ContentItem;
}

const EASE = [0.25, 0.1, 0.25, 1] as const;

export function Hero({ featured }: HeroProps) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const nsfw = isNsfwSite();

  return (
    <section
      className={
        nsfw
          ? "nsfw-hero relative min-h-[min(88vh,52rem)] w-full overflow-hidden sm:min-h-[680px]"
          : "zipo-main-hero relative h-[72vh] min-h-[560px] max-h-[820px] w-full overflow-hidden"
      }
    >
      {getBackdropUrl(featured ?? {}) || featured?.stillCandidates?.length ? (
        <ResilientImage
          candidates={[getBackdropUrl(featured ?? {}), ...(featured?.stillCandidates ?? [])]}
          alt=""
          priority
          className="object-cover object-center"
          sizes="100vw"
          placeholderLabel={featured?.title}
        />
      ) : (
        <div className="absolute inset-0 bg-zipo-surface" />
      )}

      <div
        className={
          nsfw
            ? "absolute inset-0 z-[1] bg-[linear-gradient(100deg,#0a090c_0%,rgba(10,9,12,.88)_26%,rgba(10,9,12,.35)_58%,rgba(10,9,12,.12)_100%)]"
            : "absolute inset-0 bg-[linear-gradient(90deg,var(--zipo-bg)_0%,color-mix(in_srgb,var(--zipo-bg)_88%,transparent)_34%,color-mix(in_srgb,var(--zipo-bg)_24%,transparent)_72%,transparent_100%)]"
        }
      />
      {!nsfw && <div className="absolute inset-0 bg-gradient-to-t from-zipo-bg via-transparent to-black/20" />}
      {!nsfw && <div className="zipo-projection-line" aria-hidden="true" />}

      <div className="relative z-10 flex min-h-[inherit] items-end px-4 pb-24 pt-28 sm:items-center sm:pb-0 sm:pt-20 sm:px-6 lg:px-10">
        <div className={nsfw ? "mx-auto w-full max-w-[1600px]" : "mx-auto w-full max-w-7xl"}>
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="max-w-2xl"
          >
            {featured ? (
              <>
                <p className={nsfw ? "nsfw-kicker mb-5" : "mb-4 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-zipo-accent before:h-px before:w-8 before:bg-current"}>
                  {t("featured")}
                </p>
                <h1
                  className={
                    nsfw
                      ? "max-w-2xl font-display text-5xl font-semibold leading-[0.94] tracking-[-0.045em] text-white text-balance sm:text-7xl lg:text-[5.5rem]"
                      : "max-w-2xl text-4xl font-semibold leading-[0.96] tracking-[-0.055em] text-zipo-text text-balance sm:text-6xl lg:text-[5.1rem]"
                  }
                >
                  {featured.title}
                </h1>
                {nsfw && (
                  <div className="mt-6 flex flex-wrap items-center gap-2">
                    <span className="nsfw-badge-18" aria-label="Conteúdo 18+">18+</span>
                    {featured.year && (
                      <span className="nsfw-meta-chip tabular-nums">{featured.year}</span>
                    )}
                    {featured.rating != null && (
                      <span className="nsfw-meta-chip tabular-nums">
                        <Star className="h-3.5 w-3.5 fill-zipo-accent text-zipo-accent" aria-hidden="true" />
                        {featured.rating.toFixed(1)}
                      </span>
                    )}
                    <span className="nsfw-meta-chip">
                      {featured.type === "movie" ? "Filme" : featured.type === "series" ? "Série" : "Anime"}
                    </span>
                  </div>
                )}
                {featured.description && (
                  <p
                    className={
                      nsfw
                        ? "mt-6 max-w-xl text-base leading-7 text-white/72 text-pretty sm:line-clamp-3"
                        : "mt-6 line-clamp-3 max-w-xl text-sm leading-7 text-zipo-text-secondary sm:text-base"
                    }
                  >
                    {featured.description}
                  </p>
                )}
                <div className={nsfw ? "mt-9 flex flex-wrap gap-3" : "mt-8 flex flex-wrap gap-3"}>
                  <Link
                    href={
                      featured.type === "movie"
                        ? `/watch/${featured.type}/${featured.id}`
                        : `/watch/${featured.type}/${featured.id}${watchEpisodeQuery(1)}`
                    }
                    className={nsfw ? "btn-primary min-w-[190px] px-8 text-base shadow-lg" : "btn-primary min-h-12 min-w-[150px] px-7 text-base"}
                  >
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    {tc("watchNow")}
                  </Link>
                  <Link
                    href={`/${featured.type}/${featured.id}`}
                    className={nsfw ? "btn-secondary min-w-[150px]" : "btn-secondary min-h-12 min-w-[130px] bg-zipo-bg/65 backdrop-blur-sm"}
                  >
                    <Info className="h-4 w-4" aria-hidden="true" />
                    {tc("moreInfo")}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-3xl font-semibold leading-tight text-zipo-text sm:text-5xl">
                  {t("heroTitle")}
                </h1>
                <div className="mt-6">
                  <Link href="/explore/movie" className="btn-primary min-w-[160px]">
                    <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                    {tc("watchNow")}
                  </Link>
                </div>
              </>
            )}
          </motion.div>
        </div>
      </div>

      <div
        className={
          nsfw
            ? "absolute bottom-0 left-0 right-0 z-[2] h-36 bg-gradient-to-t from-zipo-bg via-zipo-bg/80 to-transparent"
            : "absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-zipo-bg to-transparent"
        }
      />
    </section>
  );
}
