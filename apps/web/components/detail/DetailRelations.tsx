"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import type { WebEnrichedContent } from "@/lib/enriched-content";
import { ResilientImage } from "@/components/ResilientImage";

function relationHref(id: string) {
  return `/anime/${id}`;
}

export function DetailRelations({
  relations,
}: {
  relations: NonNullable<WebEnrichedContent["relations"]>;
}) {
  const t = useTranslations("detail");

  const relationLabel = (type: string) => {
    const key = type.toUpperCase().replace(/\s+/g, "_");
    const labels: Record<string, string> = {
      SEQUEL: t("relationType.SEQUEL"),
      PREQUEL: t("relationType.PREQUEL"),
      SIDE_STORY: t("relationType.SIDE_STORY"),
      PARENT: t("relationType.PARENT"),
      SUMMARY: t("relationType.SUMMARY"),
      ALTERNATIVE: t("relationType.ALTERNATIVE"),
      SPIN_OFF: t("relationType.SPIN_OFF"),
      CHARACTER: t("relationType.CHARACTER"),
      OTHER: t("relationType.OTHER"),
      RELATED: t("relationType.RELATED"),
    };
    return labels[key] ?? type.replace(/_/g, " ");
  };

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("relations")}</h2>
      <div className="mt-4 -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 scrollbar-thin">
        {relations.map((rel) => (
          <Link
            key={`${rel.type}-${rel.id}`}
            href={relationHref(rel.id)}
            className="w-36 shrink-0 rounded-lg border border-zipo-border glass-card transition-colors hover:border-zipo-accent/50"
          >
            <div className="relative aspect-[2/3] w-full overflow-hidden rounded-t-lg bg-zipo-elevated">
              <ResilientImage candidates={[rel.poster]} alt={rel.title} sizes="144px" placeholderLabel={rel.title} />
            </div>
            <div className="p-2">
              <p className="line-clamp-2 text-sm font-medium text-zipo-text">{rel.title}</p>
              <p className="mt-0.5 text-xs text-zipo-muted">{relationLabel(rel.type)}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
