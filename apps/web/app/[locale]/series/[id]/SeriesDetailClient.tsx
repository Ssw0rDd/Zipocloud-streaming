"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import { fetchEnrichedContent } from "@/lib/enriched-content";
import { CommentSection } from "@/components/comments";
import { EnrichedDetailView } from "@/components/detail/EnrichedDetailView";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";

export function SeriesDetailClient({ id }: { id: string }) {
  const locale = useLocale();

  const { data, isLoading } = useQuery({
    queryKey: ["content", "series", id, "enriched", locale],
    queryFn: () => fetchEnrichedContent("series", id, locale),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <Skeleton className="h-[50vh] w-full rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <PageTransition>
      <EnrichedDetailView
        type="series"
        id={id}
        data={data}
        showComments={<CommentSection contentType="series" contentId={id} />}
      />
    </PageTransition>
  );
}
