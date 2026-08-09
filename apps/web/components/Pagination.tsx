"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface PaginationProps {
  total: number;
  loaded: number;
  onLoadMore: () => void;
  isLoading?: boolean;
  className?: string;
}

export function Pagination({
  total,
  loaded,
  onLoadMore,
  isLoading = false,
  className,
}: PaginationProps) {
  const t = useTranslations("pagination");
  const hasMore = loaded < total;

  if (total === 0) return null;

  return (
    <div className={cn("flex flex-col items-center gap-3 pt-8", className)}>
      <p className="text-sm text-zipo-muted">
        {loaded} {t("of")} {total}
      </p>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoading}
          className="btn-secondary min-w-[160px] disabled:opacity-50"
        >
          {isLoading ? (
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            t("loadMore")
          )}
        </button>
      )}
    </div>
  );
}
