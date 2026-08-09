import { GridSkeleton, Skeleton } from "@/components/Skeleton";

export default function ExploreLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6" aria-busy="true">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-10 w-full max-w-xl rounded-lg" />
      <GridSkeleton count={12} />
    </div>
  );
}
