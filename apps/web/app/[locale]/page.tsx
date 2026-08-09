import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { setRequestLocale } from "next-intl/server";
import { HomePage } from "./HomePage";
import { fetchHomeAggregated } from "@/lib/api";
import { makeQueryClient } from "@/lib/get-query-client";
import { queryKeys } from "@/lib/query-config";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const queryClient = makeQueryClient();
  await queryClient.prefetchQuery({
    queryKey: queryKeys.homeAggregate(locale),
    queryFn: () => fetchHomeAggregated(locale),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <HomePage />
    </HydrationBoundary>
  );
}
