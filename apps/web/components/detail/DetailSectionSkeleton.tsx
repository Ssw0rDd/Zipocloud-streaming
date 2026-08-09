import { Skeleton } from "@/components/Skeleton";

export function DetailSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mt-10 space-y-4">
      <Skeleton className="h-7 w-40" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
