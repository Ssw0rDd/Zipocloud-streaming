import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { fetchEnrichedContent } from "@/lib/enriched-content";
import { makeQueryClient } from "@/lib/get-query-client";
import { SeriesDetailClient } from "./SeriesDetailClient";

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  setRequestLocale(locale);

  const queryClient = makeQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["content", "series", id, "enriched", locale],
    queryFn: () => fetchEnrichedContent("series", id, locale),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <SeriesDetailClient id={id} />
    </HydrationBoundary>
  );
}
