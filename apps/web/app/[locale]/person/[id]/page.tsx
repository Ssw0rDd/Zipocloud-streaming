"use client";

import { use } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";
import { fetchPerson, fetchPersonCredits } from "@/lib/api";

function formatDate(value: string | undefined, locale: string) {
  if (!value) return undefined;
  try {
    return new Date(value).toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return value;
  }
}

export default function PersonPage({
  params,
}: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = use(params);
  const personId = Number(id);
  const t = useTranslations("person");

  const { data: person, isLoading } = useQuery({
    queryKey: ["person", personId],
    queryFn: () => fetchPerson(personId),
    enabled: Number.isFinite(personId) && personId > 0,
  });

  const { data: creditsData } = useQuery({
    queryKey: ["person", personId, "credits"],
    queryFn: () => fetchPersonCredits(personId),
    enabled: Number.isFinite(personId) && personId > 0,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!person) return null;

  const credits = creditsData?.credits ?? [];

  return (
    <PageTransition>
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="relative mx-auto aspect-[2/3] w-40 shrink-0 overflow-hidden rounded-xl border border-zipo-border bg-zipo-elevated sm:mx-0">
            {person.image ? (
              <Image
                src={person.image}
                alt={person.name}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center text-4xl font-bold text-zipo-muted">
                {person.name.charAt(0)}
              </div>
            )}
          </div>

          <div className="flex-1">
            <h1 className="text-3xl font-bold tracking-wide text-zipo-text sm:text-4xl">
              {person.name}
            </h1>

            <dl className="mt-4 space-y-2 text-sm text-zipo-muted">
              {person.birthday && (
                <div>
                  <dt className="inline font-medium text-zipo-text">{t("birthday")}: </dt>
                  <dd className="inline">{formatDate(person.birthday, locale)}</dd>
                </div>
              )}
              {person.deathday && (
                <div>
                  <dt className="inline font-medium text-zipo-text">{t("deathday")}: </dt>
                  <dd className="inline">{formatDate(person.deathday, locale)}</dd>
                </div>
              )}
              {person.country && (
                <div>
                  <dt className="inline font-medium text-zipo-text">{t("country")}: </dt>
                  <dd className="inline">{person.country}</dd>
                </div>
              )}
              {person.gender && (
                <div>
                  <dt className="inline font-medium text-zipo-text">{t("gender")}: </dt>
                  <dd className="inline">{person.gender}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {credits.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-semibold tracking-wide text-zipo-text">
              {t("filmography")}
            </h2>
            <ul className="mt-4 space-y-3">
              {credits.map((credit, index) => (
                <li
                  key={`${credit.showName}-${credit.character ?? index}`}
                  className="rounded-lg border border-zipo-border glass-card p-4"
                >
                  <p className="font-medium text-zipo-text">{credit.showName}</p>
                  {credit.character && (
                    <p className="mt-1 text-sm text-zipo-muted">
                      {t("asCharacter", { character: credit.character })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {credits.length === 0 && (
          <p className="mt-10 text-sm text-zipo-muted">{t("noCredits")}</p>
        )}
      </div>
    </PageTransition>
  );
}
