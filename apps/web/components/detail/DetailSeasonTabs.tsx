"use client";



import { useState } from "react";

import { useTranslations } from "next-intl";

import { EpisodeCard } from "@/components/EpisodeCard";
import { watchEpisodeQuery } from "@/lib/watch-episode";

import type { WebEnrichedSeason } from "@/lib/enriched-content";



interface DetailSeasonTabsProps {

  seasons: WebEnrichedSeason[];

  contentId: string;

  contentType: "series";

}



export function DetailSeasonTabs({ seasons, contentId, contentType }: DetailSeasonTabsProps) {

  const t = useTranslations("detail");

  const tw = useTranslations("watch");

  const [activeSeason, setActiveSeason] = useState(seasons[0]?.number ?? 1);



  const current = seasons.find((s) => s.number === activeSeason) ?? seasons[0];

  if (!current) return null;



  return (

    <section className="mt-10">

      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("seasons")}</h2>



      {seasons.length > 1 && (

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">

          {seasons.map((season) => (

            <button

              key={season.number}

              type="button"

              onClick={() => setActiveSeason(season.number)}

              className={`shrink-0 rounded-lg border px-4 py-2 text-sm font-medium transition-[border-color,background-color,color,box-shadow] duration-200 ${

                season.number === activeSeason

                  ? "border-zipo-accent bg-zipo-accent/10 text-zipo-accent shadow-[0_2px_8px_var(--zipo-shadow)]"

                  : "border-zipo-border text-zipo-muted hover:border-zipo-accent/40 hover:text-zipo-text"

              }`}

            >

              {tw("season", { number: season.number })}

              {season.episodeCount != null && (

                <span className="ml-1 text-xs opacity-70">({season.episodeCount})</span>

              )}

            </button>

          ))}

        </div>

      )}



      <div className="mt-4 space-y-3">

        {current.episodes.map((ep) => (

          <EpisodeCard

            key={ep.id}

            ep={ep}

            href={`/watch/${contentType}/${contentId}${watchEpisodeQuery(ep.number, ep.season ?? activeSeason)}`}

            layout="wide"

          />

        ))}

      </div>

    </section>

  );

}

