import { setRequestLocale } from "next-intl/server";
import { HistoryPageClient } from "./HistoryPageClient";

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HistoryPageClient />;
}
