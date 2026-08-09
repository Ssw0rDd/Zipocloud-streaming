import { useTranslations } from "next-intl";
import { formatRating } from "@/lib/utils";
import type { WebEnrichedContent } from "@/lib/enriched-content";

const PROVIDER_COLORS: Record<string, string> = {
  MAL: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  AniList: "border-pink-500/40 bg-pink-500/10 text-pink-300",
  Kitsu: "border-orange-500/40 bg-orange-500/10 text-orange-300",
  IMDb: "border-yellow-500/40 bg-yellow-500/10 text-yellow-300",
};

export function DetailScores({ scores }: { scores: WebEnrichedContent["scores"] }) {
  const t = useTranslations("detail");

  if (!scores?.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("scores")}</h2>
      <div className="mt-4 flex flex-wrap gap-3">
        {scores.map((score) => (
          <span
            key={score.provider}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium ${
              PROVIDER_COLORS[score.provider] ?? "border-zipo-border bg-zipo-elevated text-zipo-text"
            }`}
          >
            <span>{score.provider}</span>
            <span className="font-bold">{formatRating(score.value)}</span>
            {score.max != null && score.max !== 10 && (
              <span className="text-xs opacity-70">/ {score.max}</span>
            )}
          </span>
        ))}
      </div>
    </section>
  );
}
