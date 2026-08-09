import { Skeleton } from "@/components/Skeleton";

export default function PlaylistsLoading() {
  return (
    <div className="mx-auto mt-16 max-w-3xl space-y-4 px-4" aria-busy="true">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  );
}
