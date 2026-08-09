"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Film, Play, Star } from "lucide-react";
import type { ContentDetail, ContentType } from "@/lib/api";
import { getBackdropUrl, getPosterUrl } from "@/lib/api";
import { formatDuration, formatRating } from "@/lib/utils";
import { ReactionBar } from "@/components/ReactionBar";
import { AddToPlaylistButton } from "@/components/playlists/AddToPlaylistButton";
import { EpisodeNotifyButton } from "@/components/anilist/AniListActions";
import { EpisodeCard } from "@/components/EpisodeCard";
import { DetailCast } from "@/components/detail/DetailCast";
import { DetailTrailer } from "@/components/detail/DetailTrailer";
import { TrailerModal } from "@/components/TrailerModal";
import { cn } from "@/lib/utils";
import { watchEpisodeQuery, firstEpisodeNumber } from "@/lib/watch-episode";
import { ResilientImage } from "@/components/ResilientImage";

interface EnrichedDetailViewProps {
  type: ContentType;
  id: string;
  data: ContentDetail;
  showComments?: React.ReactNode;
}

export function EnrichedDetailView({
  type,
  id,
  data,
  showComments,
}: EnrichedDetailViewProps) {
  const t = useTranslations("detail");
  const tc = useTranslations("common");
  const [activeSeason, setActiveSeason] = useState(
    data.seasons?.[0]?.number ?? 1,
  );
  const [trailerModalOpen, setTrailerModalOpen] = useState(false);

  const activeSeasonData = data.seasons?.find((s) => s.number === activeSeason);
  const seasonEpisodes =
    activeSeasonData?.episodes ??
    data.episodes?.filter((ep) => (ep.season ?? 1) === activeSeason);

  return (
    <div className="relative">
      {(getBackdropUrl(data) || data.stillCandidates?.length) && (
        <div className="absolute inset-0 h-[60vh]">
          <ResilientImage
            candidates={[getBackdropUrl(data), ...(data.stillCandidates ?? [])]}
            alt=""
            className="object-cover opacity-30"
            sizes="100vw"
            placeholderLabel={data.title}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zipo-bg via-zipo-bg/60 to-transparent" />
        </div>
      )}

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-8 md:flex-row">
          <div className="relative mx-auto aspect-[2/3] w-64 shrink-0 overflow-hidden rounded-2xl border border-zipo-border-subtle bg-zipo-surface shadow-sm sm:w-72 md:mx-0 lg:w-80">
            <ResilientImage
              candidates={[getPosterUrl(data), ...(data.posterCandidates ?? [])]}
              alt={data.title}
              className="object-contain"
              sizes="(max-width: 640px) 16rem, (max-width: 1024px) 18rem, 20rem"
              quality={92}
              placeholderLabel={data.title}
            />
          </div>

          <div className="flex-1">
            <h1 className="text-4xl font-bold tracking-wide text-zipo-text sm:text-5xl">
              {data.title}
            </h1>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-zipo-muted">
              {data.year && (
                <span>
                  {t("year")}: {data.year}
                </span>
              )}
              {data.rating != null && (
                <span className="inline-flex items-center gap-1">
                  <Star
                    className="h-3.5 w-3.5 fill-zipo-accent text-zipo-accent"
                    aria-hidden="true"
                  />
                  {t("rating")}: {formatRating(data.rating)}
                </span>
              )}
              {data.duration != null && (
                <span>
                  {t("duration")}: {formatDuration(data.duration)}
                </span>
              )}
              {data.episodeCount != null && (
                <span>
                  {t("episodes")}: {data.episodeCount}
                </span>
              )}
            </div>

            {data.scores && data.scores.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.scores.map((score) => (
                  <span
                    key={score.provider}
                    className="rounded-full border border-zipo-border bg-zipo-elevated px-3 py-1 text-xs font-medium text-zipo-text"
                  >
                    {score.provider}: {formatRating(score.value)}
                  </span>
                ))}
              </div>
            )}

            {data.genres && (
              <div className="mt-4 flex flex-wrap gap-2">
                {data.genres.map((g) => (
                  <span
                    key={g}
                    className="rounded-full border border-zipo-accent/30 px-3 py-1 text-xs text-zipo-accent"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}

            {data.description && (
              <div className="mt-6 max-w-2xl">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zipo-text">
                  {t("synopsis")}
                </h2>
                <p className="mt-2 leading-relaxed text-zipo-muted">{data.description}</p>
              </div>
            )}

            <DetailCast cast={data.cast} castCredits={data.castCredits} />
            {data.director && (
              <p className="mt-2 text-sm text-zipo-muted">
                <span className="text-zipo-text">{t("director")}:</span>{" "}
                {data.director}
              </p>
            )}

            <ReactionBar contentType={type} contentId={id} className="mt-6" />

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href={
                  type === "movie"
                    ? `/watch/${type}/${id}`
                    : `/watch/${type}/${id}${watchEpisodeQuery(firstEpisodeNumber(data.episodes), data.episodes?.[0]?.season)}`
                }
                className="inline-flex items-center gap-2 rounded-lg bg-zipo-accent px-6 py-3 font-semibold text-white transition-colors duration-150 hover:bg-zipo-accent-hover active:scale-[0.98] motion-reduce:transform-none"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                {tc("watchNow")}
              </Link>
              {data.trailer && (
                <button
                  type="button"
                  onClick={() => setTrailerModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-zipo-border bg-zipo-surface px-5 py-3 font-medium text-zipo-text transition-colors hover:border-zipo-accent/50 hover:bg-zipo-elevated"
                >
                  <Film className="h-4 w-4" aria-hidden="true" />
                  {tc("playTrailer")}
                </button>
              )}
              <AddToPlaylistButton contentType={type} contentId={id} />
              {type === "anime" && <EpisodeNotifyButton animeId={id} />}
            </div>
            {data.trailer && (
              <TrailerModal
                open={trailerModalOpen}
                onClose={() => setTrailerModalOpen(false)}
                trailer={data.trailer}
                title={data.title}
              />
            )}
          </div>
        </div>

        <DetailTrailer trailer={data.trailer} title={data.title} />

        {data.characters && data.characters.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold text-zipo-text">
              {t("characters")}
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {data.characters.map((ch, index) => (
                <div
                  key={`${ch.name}-${ch.role ?? ""}-${index}`}
                  className="w-28 shrink-0 text-center"
                >
                  <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-full bg-zipo-surface">
                    {ch.image ? (
                      <Image
                        src={ch.image}
                        alt={ch.name}
                        fill
                        className="object-cover"
                        sizes="112px"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-2xl font-bold text-zipo-muted">
                        {ch.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm font-medium text-zipo-text">
                    {ch.name}
                  </p>
                  {ch.role && (
                    <p className="text-xs text-zipo-muted">{ch.role}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {data.relations && data.relations.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold text-zipo-text">
              {t("relations")}
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-2">
              {data.relations.map((rel) => (
                <Link
                  key={`${rel.id}-${rel.type}`}
                  href={`/anime/${rel.id}`}
                  className="shrink-0 rounded-lg border border-zipo-border bg-zipo-elevated px-4 py-3 text-sm transition-colors hover:border-zipo-accent/50"
                >
                  <p className="font-medium text-zipo-text">{rel.title}</p>
                  <p className="text-xs text-zipo-muted">{rel.type}</p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.recommendations && data.recommendations.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold text-zipo-text">
              {t("recommendations")}
            </h2>
            <div className="flex gap-4 overflow-x-auto pb-2">
              {data.recommendations.map((rec) => (
                <Link
                  key={rec.id}
                  href={`/anime/${rec.id}`}
                  className="w-32 shrink-0"
                >
                  <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-zipo-surface">
                    <ResilientImage candidates={[rec.poster]} alt={rec.title} sizes="128px" placeholderLabel={rec.title} />
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-zipo-text">
                    {rec.title}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}

        {(type === "series" || type === "anime") &&
          (data.seasons?.length || data.episodes?.length) && (
          <section className="mt-12">
            <h2 className="mb-4 text-xl font-semibold text-zipo-text">
              {t("episodes")}
            </h2>
            {data.seasons && data.seasons.length > 1 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {data.seasons.map((season) => (
                  <button
                    key={season.number}
                    type="button"
                    onClick={() => setActiveSeason(season.number)}
                    className={cn(
                      "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                      activeSeason === season.number
                        ? "bg-zipo-accent text-white"
                        : "border border-zipo-border text-zipo-muted hover:text-zipo-text",
                    )}
                  >
                    {t("seasonTab", { number: season.number })}
                  </button>
                ))}
              </div>
            )}
            {seasonEpisodes && seasonEpisodes.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                {seasonEpisodes.map((ep) => (
                  <EpisodeCard
                    key={ep.id}
                    ep={{
                      id: ep.id,
                      number: ep.number,
                      title: ep.title,
                      description: ep.description,
                      duration: ep.duration,
                      still: ep.still,
                      stillCandidates: ep.stillCandidates,
                    }}
                    href={`/watch/${type}/${id}${watchEpisodeQuery(ep.number, ep.season ?? activeSeason)}`}
                    layout="wide"
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {showComments}
      </div>
    </div>
  );
}
