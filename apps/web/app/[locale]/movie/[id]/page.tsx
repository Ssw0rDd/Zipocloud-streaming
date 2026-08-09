import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { fetchEnrichedContent } from "@/lib/enriched-content";
import { makeQueryClient } from "@/lib/get-query-client";
import { MovieDetailClient } from "./MovieDetailClient";

export default async function MoviePage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  setRequestLocale(locale);

  const queryClient = makeQueryClient();
  await queryClient.prefetchQuery({
    queryKey: ["content", "movie", id, "enriched", locale],
    queryFn: () => fetchEnrichedContent("movie", id, locale),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MovieDetailClient id={id} />
    </HydrationBoundary>
  );
}
