"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Download, Loader2, RotateCcw, TriangleAlert } from "lucide-react";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";
import { fetchClip } from "@/lib/api";
import { formatPlayerTime } from "@/components/player/utils";
import { useAuth } from "@/hooks/useAuth";

interface ClipPageClientProps {
  token: string;
}

export function ClipPageClient({ token }: ClipPageClientProps) {
  const t = useTranslations("clip");
  const { isLoggedIn } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["clip", token],
    queryFn: () => fetchClip(token),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2_000 : false;
    },
  });

  if (isLoading) {
    return <Skeleton className="aspect-video w-full rounded-xl" />;
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <TriangleAlert className="mx-auto h-9 w-9 text-zipo-accent" />
        <h1 className="mt-4 text-xl font-semibold text-zipo-text">Clip indisponível</h1>
        <p className="mt-2 text-sm text-zipo-muted">O link expirou, não existe ou exige uma conta.</p>
        {!isLoggedIn && <Link href="/auth/login" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-zipo-accent px-5 font-semibold text-white">Entrar</Link>}
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-zipo-accent">
          {t("sharedClip")}
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-wide text-white sm:text-4xl">
          {data.title}
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          {formatPlayerTime(data.startTime)} — {formatPlayerTime(data.endTime)}
        </p>

        <div className="mt-8 overflow-hidden rounded-xl border border-zipo-border bg-black">
          {data.status === "ready" && data.mediaUrl ? (
            <video
              src={data.mediaUrl}
              className="aspect-video w-full bg-black object-contain"
              autoPlay
              loop
              controls
              playsInline
              aria-label={data.title}
            />
          ) : data.status === "failed" ? (
            <div className="flex aspect-video flex-col items-center justify-center p-6 text-center">
              <TriangleAlert className="h-8 w-8 text-red-400" aria-hidden="true" />
              <p className="mt-3 text-sm text-zipo-text">Não foi possível gerar este clip.</p>
              <p className="mt-1 text-xs text-zipo-muted">O registro foi preservado para nova tentativa.</p>
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center p-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-zipo-accent motion-reduce:animate-none" aria-hidden="true" />
              <p className="mt-3 text-sm text-zipo-text">Processando clip…</p>
              <p className="mt-1 text-xs tabular-nums text-zipo-muted">{data.progress ?? 0}%</p>
            </div>
          )}
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {data.status === "ready" && data.downloadUrl && (
            <a
              href={data.downloadUrl}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-zipo-accent px-5 text-sm font-semibold text-white hover:bg-zipo-accent-hover"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Download
            </a>
          )}
          <Link
            href={`/watch/${data.contentType}/${data.contentId}`}
            className="rounded-lg border border-zipo-accent/30 px-6 py-3 text-sm font-semibold text-zipo-accent transition-colors hover:bg-zipo-accent/10"
          >
            {t("watchFull")}
          </Link>
          {data.status === "ready" && (
            <span className="inline-flex min-h-11 items-center gap-2 px-3 text-xs text-zipo-muted">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Reprodução em loop
            </span>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
