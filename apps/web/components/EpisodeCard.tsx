"use client";

import { Link } from "@/i18n/routing";
import { formatDuration } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ResilientImage } from "@/components/ResilientImage";

export interface EpisodeCardData {
  id: string;
  number: number;
  title: string;
  description?: string;
  duration?: number;
  still?: string;
  stillCandidates?: string[];
}

interface EpisodeCardProps {
  ep: EpisodeCardData;
  href?: string;
  active?: boolean;
  onClick?: () => void;
  onNavigate?: () => void;
  layout?: "compact" | "wide";
  className?: string;
}

export function EpisodeCard({
  ep,
  href,
  active = false,
  onClick,
  onNavigate,
  layout = "compact",
  className,
}: EpisodeCardProps) {
  const isWide = layout === "wide";
  const thumbnail = (
    <div
      className={cn(
        "episode-number relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border font-semibold tabular-nums",
        isWide ? "h-16 w-28 text-base" : "h-12 w-[4.5rem] text-sm",
        active
          ? "border-zipo-accent/50 bg-zipo-accent/15 text-zipo-accent"
          : "border-zipo-border-subtle bg-zipo-surface text-zipo-muted",
      )}
    >
      {ep.still || ep.stillCandidates?.length ? (
        <>
          <ResilientImage
            candidates={[...(ep.stillCandidates ?? []), ep.still]}
            alt=""
            sizes={isWide ? "112px" : "72px"}
            quality={55}
            className="object-cover"
            placeholderLabel={String(ep.number).padStart(2, "0")}
          />
          <span className="absolute bottom-1 left-1 rounded bg-zipo-bg/85 px-1.5 py-0.5 text-[10px] font-bold leading-none text-zipo-text shadow-sm">
            {String(ep.number).padStart(2, "0")}
          </span>
        </>
      ) : (
        String(ep.number).padStart(2, "0")
      )}
    </div>
  );

  const body = (
    <div className="min-w-0 flex-1 py-0.5">
      <p
        className={cn(
          "line-clamp-2 leading-snug transition-colors duration-200",
          isWide ? "text-sm font-semibold" : "text-sm font-medium",
          active ? "text-zipo-accent" : "text-zipo-text group-hover:text-zipo-accent",
        )}
      >
        {ep.title}
      </p>
      {ep.description && isWide && (
        <p className="mt-1 line-clamp-2 text-sm text-zipo-muted">{ep.description}</p>
      )}
      {ep.duration != null && isWide && (
        <p className="mt-1 text-xs text-zipo-muted">{formatDuration(ep.duration)}</p>
      )}
    </div>
  );

  const rowClass = cn(
    "group episode-card flex w-full items-center gap-3 rounded-xl text-left",
    isWide ? "min-h-20 border border-zipo-border-subtle p-3 glass-card" : "min-h-14 p-2",
    active
      ? "bg-zipo-accent/15 ring-1 ring-zipo-accent/30"
      : isWide
        ? "hover:border-zipo-accent/50 hover:shadow-[0_4px_12px_var(--zipo-shadow-hover)]"
        : "hover:bg-zipo-elevated hover:shadow-[0_2px_8px_var(--zipo-shadow)]",
    className,
  );

  const content = (
    <>
      {thumbnail}
      {body}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        data-ep={ep.number}
        onClick={onClick}
        className={rowClass}
        aria-current={active ? "true" : undefined}
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        data-ep={ep.number}
        onClick={onNavigate}
        className={rowClass}
        aria-current={active ? "true" : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <div data-ep={ep.number} className={rowClass}>
      {content}
    </div>
  );
}
