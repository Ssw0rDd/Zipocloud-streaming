"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Film } from "lucide-react";
import { nextImageCandidates } from "@zipo/shared";
import { cn } from "@/lib/utils";

/** Pipeline already serves optimized WebP/AVIF — skip a second pass via /_next/image. */
function shouldBypassOptimizer(source: string): boolean {
  return source.startsWith("/api/v1/images/");
}

interface ResilientImageProps {
  candidates?: Array<string | null | undefined>;
  alt: string;
  sizes: string;
  priority?: boolean;
  quality?: number;
  className?: string;
  placeholderLabel?: string;
}

export function ResilientImage({
  candidates,
  alt,
  sizes,
  priority = false,
  quality,
  className,
  placeholderLabel,
}: ResilientImageProps) {
  // Drop hosts not in next/image allowlist (e.g. Crunchyroll) before render — Next throws, not onError.
  const valid = useMemo(() => nextImageCandidates(candidates ?? []), [candidates]);
  const validKey = valid.join("|");
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [validKey]);

  const source = valid[index];
  if (!source) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-zipo-surface p-3 text-center text-zipo-muted" role="img" aria-label={alt || placeholderLabel || "Imagem indisponível"}>
        <Film className="h-7 w-7" aria-hidden="true" />
        {placeholderLabel && <span className="mt-2 line-clamp-2 text-xs font-medium">{placeholderLabel}</span>}
      </div>
    );
  }

  return (
    <Image
      key={source}
      src={source}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      quality={quality ?? 85}
      unoptimized={shouldBypassOptimizer(source)}
      className={cn("object-cover", className)}
      onError={() => setIndex((current) => current + 1)}
    />
  );
}
