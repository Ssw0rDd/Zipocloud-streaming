"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import type { WebEnrichedContent } from "@/lib/enriched-content";

export function DetailCharacters({
  characters,
}: {
  characters: NonNullable<WebEnrichedContent["characters"]>;
}) {
  const t = useTranslations("detail");

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("characters")}</h2>
      <div className="mt-4 grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {characters.map((char, index) => (
          <div key={`${char.name}-${char.role ?? ""}-${index}`} className="text-center">
            <div className="relative mx-auto aspect-square w-full max-w-[100px] overflow-hidden rounded-full border border-zipo-border bg-zipo-elevated">
              {char.image ? (
                <Image src={char.image} alt={char.name} fill className="object-cover" sizes="100px" />
              ) : (
                <div className="flex h-full items-center justify-center text-2xl text-zipo-muted">
                  {char.name.charAt(0)}
                </div>
              )}
            </div>
            <p className="mt-2 truncate text-sm font-medium text-zipo-text">{char.name}</p>
            {char.role && (
              <p className="truncate text-xs text-zipo-muted">{char.role}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
