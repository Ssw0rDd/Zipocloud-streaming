"use client";

import { useState } from "react";
import { ArrowLeft, Check, Clapperboard, Flag, Layers, RotateCcw, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import type { PlaybackIssueCode } from "@zipo/shared";
import { cn } from "@/lib/utils";

interface PlayerErrorStateProps {
  code?: PlaybackIssueCode;
  message?: string;
  onRetry?: () => void;
  onSwitchProvider?: () => void;
  onShowTrailer?: () => void;
  onBackToDetails?: () => void;
  onReport?: () => Promise<void>;
  showSwitchProvider?: boolean;
  className?: string;
}

export function PlayerErrorState({
  code = "PLAYBACK_FAILED",
  message,
  onRetry,
  onSwitchProvider,
  onShowTrailer,
  onBackToDetails,
  onReport,
  showSwitchProvider = false,
  className,
}: PlayerErrorStateProps) {
  const t = useTranslations("player");
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportFailed, setReportFailed] = useState(false);

  const copy = code === "PLAYBACK_UNAVAILABLE"
    ? {
        title: "Sem fonte segura compatível",
        description: message ?? "O título existe no catálogo, mas nenhum player nativo ou embed protegido pôde reproduzi-lo.",
      }
    : code === "SESSION_EXPIRED"
      ? {
          title: "A sessão de reprodução expirou",
          description: "Crie uma sessão nova para continuar com segurança.",
        }
      : code === "ADULT_LOGIN_REQUIRED"
        ? {
            title: "Entre para assistir a este título",
            description: "Conteúdo adulto exige uma conta autenticada.",
          }
        : {
            title: "A reprodução foi interrompida",
            description: message ?? t("playbackError"),
          };

  return (
    <div
      className={cn(
        "flex min-h-[360px] aspect-video w-full flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-10 text-center",
        className,
      )}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900">
        <Clapperboard className="h-7 w-7 text-zinc-400" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-semibold text-white sm:text-2xl">{copy.title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-400 sm:text-base">
        {copy.description}
      </p>
      <div className="mt-6 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-zipo-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-zipo-accent-hover"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t("retryPlayback")}
          </button>
        )}
        {onShowTrailer && (
          <button type="button" onClick={onShowTrailer} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900">
            <Clapperboard className="h-4 w-4" aria-hidden="true" />
            Assistir ao trailer
          </button>
        )}
        {onBackToDetails && (
          <button type="button" onClick={onBackToDetails} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-zinc-600 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Voltar aos detalhes
          </button>
        )}
        {showSwitchProvider && onSwitchProvider && (
          <button
            type="button"
            onClick={onSwitchProvider}
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-600 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
            {t("switchProvider")}
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-xs text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-zipo-accent" aria-hidden="true" />
          Fonte nativa verificada · nenhuma reprodução externa
        </span>
        {onReport && (
          <button
            type="button"
            disabled={reporting || reported}
            onClick={async () => {
              setReporting(true);
              setReportFailed(false);
              try {
                await onReport();
                setReported(true);
              } catch {
                setReportFailed(true);
              } finally {
                setReporting(false);
              }
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-zinc-400 hover:text-white disabled:opacity-70"
          >
            {reported ? <Check className="h-4 w-4" aria-hidden="true" /> : <Flag className="h-4 w-4" aria-hidden="true" />}
            {reported ? "Problema relatado" : reporting ? "Enviando…" : reportFailed ? "Tentar relatar novamente" : "Relatar problema"}
          </button>
        )}
      </div>
    </div>
  );
}
