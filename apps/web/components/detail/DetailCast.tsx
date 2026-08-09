"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import type { CastCredit } from "@zipo/shared";

interface DetailCastProps {
  cast?: string[];
  castCredits?: CastCredit[];
}

function normalizeMembers(
  cast?: string[],
  castCredits?: CastCredit[],
): CastCredit[] {
  if (castCredits?.length) return castCredits;
  return (cast ?? []).map((name) => ({ personId: 0, name }));
}

export function DetailCast({ cast, castCredits }: DetailCastProps) {
  const t = useTranslations("detail");
  const members = normalizeMembers(cast, castCredits).filter((m) => m.name);

  if (!members.length) return null;

  return (
    <section className="mt-10">
      <h2 className="text-xl font-semibold tracking-wide text-zipo-text">{t("cast")}</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {members.map((member, index) => {
          const key = `${member.personId}-${member.name}-${member.character ?? ""}-${index}`;
          const label = member.character
            ? `${member.name} (${member.character})`
            : member.name;

          if (member.personId > 0) {
            return (
              <Link
                key={key}
                href={`/person/${member.personId}`}
                className="inline-flex items-center gap-2 rounded-full border border-zipo-border bg-zipo-elevated px-3 py-1 text-sm text-zipo-text transition-colors hover:border-zipo-accent/50 hover:text-zipo-accent"
              >
                {member.image && (
                  <span className="relative h-6 w-6 overflow-hidden rounded-full">
                    <Image
                      src={member.image}
                      alt=""
                      fill
                      className="object-cover"
                      sizes="24px"
                    />
                  </span>
                )}
                {label}
              </Link>
            );
          }

          return (
            <span
              key={key}
              className="rounded-full border border-zipo-border bg-zipo-elevated px-3 py-1 text-sm text-zipo-text"
            >
              {label}
            </span>
          );
        })}
      </div>
    </section>
  );
}
