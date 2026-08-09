import { User, Crown, Sparkles } from "lucide-react";
import type { UserTier } from "@zipo/shared";
import { cn } from "@/lib/utils";

const tierStyles: Record<UserTier, { icon: typeof User; className: string }> = {
  guest: {
    icon: User,
    className:
      "border-zipo-border text-zipo-muted bg-zipo-elevated/60",
  },
  member: {
    icon: Sparkles,
    className:
      "border-zipo-accent/40 text-zipo-accent bg-zipo-accent/10",
  },
  supporter: {
    icon: Crown,
    className:
      "border-amber-500/40 text-amber-400 bg-amber-500/10",
  },
};

interface TierBadgeProps {
  tier: UserTier;
  label: string;
  className?: string;
}

export function TierBadge({ tier, label, className }: TierBadgeProps) {
  const { icon: Icon, className: style } = tierStyles[tier];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        style,
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
