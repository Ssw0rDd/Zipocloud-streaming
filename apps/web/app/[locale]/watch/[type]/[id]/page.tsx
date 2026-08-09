import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { contentTypeSchema, type ContentType } from "@zipo/shared";
import { fetchContentById, fetchEpisodes } from "@/lib/api";
import { makeQueryClient } from "@/lib/get-query-client";
import { queryKeys } from "@/lib/query-config";
import { WatchPageClient } from "./WatchPageClient";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ type: string; id: string; locale: string }>;
}) {
  const { type, id, locale } = await params;
  const typeResult = contentTypeSchema.safeParse(type);
  if (!typeResult.success) notFound();

  setRequestLocale(locale);
  const contentType = typeResult.data as ContentType;
  const queryClient = makeQueryClient();

  const prefetches: Promise<unknown>[] = [
    queryClient.prefetchQuery({
      queryKey: queryKeys.content(contentType, id, locale),
      queryFn: () => fetchContentById(contentType, id, locale),
    }),
  ];

  if (contentType !== "movie") {
    prefetches.push(
      queryClient.prefetchQuery({
        queryKey: ["episodes", contentType, id, locale, "base"],
        queryFn: () =>
          fetchEpisodes(contentType, id, { includeImages: false, locale }),
      }),
    );
  }

  await Promise.allSettled(prefetches);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WatchPageClient type={contentType} id={id} />
    </HydrationBoundary>
  );
}
