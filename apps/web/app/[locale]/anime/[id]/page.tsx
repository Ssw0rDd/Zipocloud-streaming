import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { fetchEnrichedContent } from "@/lib/enriched-content";
import { makeQueryClient } from "@/lib/get-query-client";
import { AnimeDetailClient } from "./AnimeDetailClient";

export default async function AnimePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  setRequestLocale(locale);

  const queryClient = makeQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["content", "anime", id, "enriched", locale],
    queryFn: () => fetchEnrichedContent("anime", id, locale),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <AnimeDetailClient id={id} />
    </HydrationBoundary>
  );
}
