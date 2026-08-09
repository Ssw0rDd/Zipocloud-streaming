import { GridSkeleton, Skeleton } from "@/components/Skeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6" aria-busy="true">
      <Skeleton className="h-12 w-full max-w-2xl rounded-xl" />
      <GridSkeleton count={8} />
    </div>
  );
}
