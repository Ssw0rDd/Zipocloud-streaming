import { cn } from "@/lib/utils";

interface ZiPoLogoProps {
  variant?: "wordmark" | "monogram";
  className?: string;
}

export function ZiPoLogo({ variant = "wordmark", className }: ZiPoLogoProps) {
  if (variant === "monogram") {
    return (
      <span
        className={cn(
          "zipo-monogram inline-flex h-9 w-9 items-center justify-center border border-zipo-border bg-zipo-elevated text-xs font-semibold tracking-tight text-zipo-text",
          className,
        )}
        aria-hidden="true"
      >
        ZP
      </span>
    );
  }

  return (
    <span
      className={cn(
        "zipo-wordmark text-base text-zipo-text sm:text-lg",
        className,
      )}
    >
      Zi<span className="text-zipo-accent">P</span>o
    </span>
  );
}
