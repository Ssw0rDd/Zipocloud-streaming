import { useTranslations } from "next-intl";
import { formatDuration } from "@/lib/utils";
import type { WebEnrichedContent } from "@/lib/enriched-content";

export function DetailProduction({ data }: { data: WebEnrichedContent }) {
  const t = useTranslations("detail");
  const production = data.production;

  const items: { label: string; value: string }[] = [];

  if (data.runtime) {
    items.push({ label: t("runtime"), value: formatDuration(data.runtime) });
  }
  if (data.status) {
    items.push({ label: t("status"), value: data.status });
  }
  if (production?.studio) {
    items.push({ label: t("studio"), value: production.studio });
  }
  if (production?.country) {
    items.push({ label: t("country"), value: production.country });
  }
  if (production?.network) {
    items.push({ label: t("network"), value: production.network });
  }
  if (data.director) {
    items.push({ label: t("director"), value: data.director });
  }

  if (!items.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("production")}</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-zipo-border glass-card p-4">
            <dt className="text-xs uppercase tracking-wide text-zipo-muted">{item.label}</dt>
            <dd className="mt-1 text-sm font-medium text-zipo-text">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
