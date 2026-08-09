import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn("skeleton rounded-lg", className)} />;
}

export function ContentCardSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function HeroSkeleton() {
  return (
    <div className="relative h-[48vh] min-h-[320px] max-h-[520px] w-full">
      <Skeleton className="absolute inset-0 rounded-none" />
    </div>
  );
}

export function GridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <ContentCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function RailSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden py-6" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[140px] shrink-0 space-y-3 sm:w-[160px]">
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function DetailPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6" aria-hidden="true">
      <Skeleton className="h-[42vh] min-h-[240px] w-full rounded-xl" />
      <div className="flex gap-6">
        <Skeleton className="hidden aspect-[2/3] w-48 shrink-0 rounded-xl sm:block" />
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-10 w-2/3 max-w-md" />
          <Skeleton className="h-4 w-full max-w-2xl" />
          <Skeleton className="h-4 w-5/6 max-w-xl" />
          <Skeleton className="h-11 w-36" />
        </div>
      </div>
    </div>
  );
}

export function CinemaPageSkeleton() {
  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_320px]" aria-hidden="true">
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="aspect-video w-full rounded-xl" />
      </div>
      <aside className="space-y-3 rounded-xl border border-zipo-border-subtle bg-zipo-elevated p-4">
        <Skeleton className="h-5 w-28" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </aside>
    </div>
  );
}

export function WatchPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl" aria-hidden="true">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <Skeleton className="mb-4 h-4 w-36" />
          <Skeleton className="mb-3 h-8 w-4/5 max-w-2xl" />
          <Skeleton className="mb-4 h-8 w-32" />
          <Skeleton className="aspect-video w-full rounded-xl" />
        </div>
        <aside className="hidden rounded-xl border border-zipo-border-subtle bg-zipo-elevated p-4 lg:block">
          <Skeleton className="mb-4 h-5 w-28" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="flex items-center gap-3 rounded-xl p-2">
                <Skeleton className="h-12 w-[4.5rem] shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
