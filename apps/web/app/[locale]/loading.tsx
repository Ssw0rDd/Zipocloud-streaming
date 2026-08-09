import { HeroSkeleton, RailSkeleton } from "@/components/Skeleton";

export default function LocaleLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <HeroSkeleton />
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <RailSkeleton />
        <RailSkeleton count={6} />
      </div>
    </div>
  );
}
