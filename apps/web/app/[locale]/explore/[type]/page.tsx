import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { contentTypeSchema, type ContentType } from "@zipo/shared";
import { fetchCatalog } from "@/lib/api";
import { makeQueryClient } from "@/lib/get-query-client";
import { queryKeys } from "@/lib/query-config";
import { ExplorePageClient, PAGE_SIZE } from "./ExplorePageClient";

export default async function ExplorePage({
  params,
}: {
  params: Promise<{ type: string; locale: string }>;
}) {
  const { type, locale } = await params;
  const typeResult = contentTypeSchema.safeParse(type);
  if (!typeResult.success) notFound();

  setRequestLocale(locale);
  const contentType = typeResult.data as ContentType;
  const queryClient = makeQueryClient();

  await queryClient.prefetchInfiniteQuery({
    queryKey: queryKeys.catalog(contentType, "explore", locale),
    queryFn: ({ pageParam = 0 }) =>
      fetchCatalog(contentType, { skip: pageParam, limit: PAGE_SIZE, locale }),
    initialPageParam: 0,
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ExplorePageClient type={contentType} locale={locale} />
    </HydrationBoundary>
  );
}
