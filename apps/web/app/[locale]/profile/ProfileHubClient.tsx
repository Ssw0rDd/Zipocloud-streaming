"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale } from "next-intl";
import Image from "next/image";
import {
  Check,
  CheckCircle2,
  Copy,
  Crown,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import { useAuth } from "@/hooks/useAuth";
import {
  createSupporterPixOrder,
  createViewerProfile,
  deleteViewerProfile,
  fetchSupporterPaymentConfig,
  fetchSupporterPixOrder,
  fetchViewerProfiles,
  importLegacyHistory,
  updateViewerProfile,
  type LegacyHistoryItem,
  type SupporterPixOrder,
} from "@/lib/api";
import { getActiveProfileId, setActiveProfileId } from "@/lib/api-client";
import { queryKeys } from "@/lib/query-config";
import { cn } from "@/lib/utils";
import { PageTransition } from "@/components/ContentRow";
import { Skeleton } from "@/components/Skeleton";

const AVATARS = ["pistachio", "coral", "sky", "violet", "sand"] as const;
const FINAL_STATUSES = new Set(["processed", "cancelled", "canceled", "expired", "refunded", "charged_back"]);

const COPY = {
  pt: {
    eyebrow: "Sua conta",
    title: "Perfis e benefícios",
    subtitle: "Cada perfil mantém histórico, progresso e recomendações separados.",
    profiles: "Quem está assistindo?",
    active: "Ativo",
    default: "Principal",
    newProfile: "Novo perfil",
    name: "Nome do perfil",
    create: "Criar perfil",
    save: "Salvar",
    cancel: "Cancelar",
    remove: "Excluir perfil",
    removeConfirm: "Excluir este perfil e seu histórico personalizado?",
    slots: (remaining: number, limit: number) => `${remaining} de ${limit} vagas disponíveis`,
    supporterTitle: "Apoie o ZiPo. Libere até 5 perfis.",
    supporterText: "Contribuição única via Pix. O valor é definido no servidor e o benefício é liberado após confirmação do Mercado Pago.",
    alreadySupporter: "Você já é apoiador",
    supporterBenefit: "Até 5 perfis independentes e identificação de apoiador.",
    unavailable: "Pagamento Pix indisponível no momento.",
    generatePix: "Gerar Pix seguro",
    pixTitle: "Pix gerado",
    pixInstructions: "Escaneie o QR Code ou copie o código. A tela atualiza automaticamente após a confirmação.",
    copyCode: "Copiar código Pix",
    copied: "Código copiado",
    openPayment: "Abrir no Mercado Pago",
    pending: "Aguardando pagamento",
    approved: "Pagamento confirmado. Benefício liberado.",
    paymentFailed: "Não foi possível gerar ou consultar o pagamento.",
    importTitle: "Trazer histórico antigo",
    importText: "Selecione um JSON exportado do app legacy. O arquivo é validado e importado no perfil ativo.",
    importChoose: "Escolher JSON",
    importAction: "Importar histórico",
    importReady: (count: number) => `${count} itens válidos prontos`,
    importDone: (count: number) => `${count} itens importados`,
    importInvalid: "Arquivo inválido. Use JSON com até 500 itens de histórico.",
    loginTitle: "Entre para gerenciar seus perfis",
    loginText: "Histórico, recomendações e benefício de apoiador dependem de uma conta.",
    login: "Entrar",
  },
  en: {
    eyebrow: "Your account",
    title: "Profiles and benefits",
    subtitle: "Each profile keeps separate history, progress, and recommendations.",
    profiles: "Who is watching?",
    active: "Active",
    default: "Primary",
    newProfile: "New profile",
    name: "Profile name",
    create: "Create profile",
    save: "Save",
    cancel: "Cancel",
    remove: "Delete profile",
    removeConfirm: "Delete this profile and its personalized history?",
    slots: (remaining: number, limit: number) => `${remaining} of ${limit} slots available`,
    supporterTitle: "Support ZiPo. Unlock up to 5 profiles.",
    supporterText: "One-time Pix contribution. The amount is fixed by the server and access is granted only after Mercado Pago confirms it.",
    alreadySupporter: "You are already a supporter",
    supporterBenefit: "Up to 5 independent profiles and a supporter badge.",
    unavailable: "Pix payment is currently unavailable.",
    generatePix: "Generate secure Pix",
    pixTitle: "Pix ready",
    pixInstructions: "Scan the QR code or copy the code. This page updates automatically after confirmation.",
    copyCode: "Copy Pix code",
    copied: "Code copied",
    openPayment: "Open Mercado Pago",
    pending: "Waiting for payment",
    approved: "Payment confirmed. Benefit granted.",
    paymentFailed: "Could not create or check the payment.",
    importTitle: "Import legacy history",
    importText: "Select a JSON export from the legacy app. It is validated and imported into the active profile.",
    importChoose: "Choose JSON",
    importAction: "Import history",
    importReady: (count: number) => `${count} valid items ready`,
    importDone: (count: number) => `${count} items imported`,
    importInvalid: "Invalid file. Use JSON with up to 500 history items.",
    loginTitle: "Sign in to manage profiles",
    loginText: "History, recommendations, and supporter benefits require an account.",
    login: "Sign in",
  },
} as const;

function messageFor(locale: string) {
  return locale.toLowerCase().startsWith("pt") ? COPY.pt : COPY.en;
}

function avatarClass(key: string) {
  return {
    pistachio: "bg-[#ff596b] text-[#210308]",
    coral: "bg-[#ff9b8d] text-[#2a0905]",
    sky: "bg-[#91a8c1] text-[#07131f]",
    violet: "bg-[#aa91d8] text-[#160b28]",
    sand: "bg-[#d9c1a6] text-[#22170d]",
  }[key] ?? "bg-zipo-elevated text-zipo-text";
}

function safeQrImage(value: string | null): string | null {
  if (!value) return null;
  const raw = value.replace(/^data:image\/png;base64,/i, "").replace(/\s/g, "");
  if (raw.length > 1_500_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  return `data:image/png;base64,${raw}`;
}

function formatBrl(cents: number, locale: string) {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(cents / 100);
}

function parseLegacyHistory(value: unknown): LegacyHistoryItem[] {
  const object = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const rawItems = Array.isArray(value)
    ? value
    : [object?.items, object?.history, object?.watchHistory, object?.progress].find(Array.isArray);
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 500) throw new Error("invalid history");
  return rawItems.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("invalid item");
    const item = raw as Record<string, unknown>;
    const contentType = item.contentType ?? item.type;
    const contentId = item.contentId ?? item.id;
    const progressSeconds = Number(item.progressSeconds ?? item.progress ?? item.currentTime ?? 0);
    const duration = item.durationSeconds ?? item.duration;
    if (!(["movie", "series", "anime"] as unknown[]).includes(contentType) || typeof contentId !== "string" || contentId.length < 1 || contentId.length > 64 || !Number.isFinite(progressSeconds) || progressSeconds < 0) throw new Error("invalid item");
    const integer = (input: unknown, min: number, max: number) => {
      if (input == null || input === "") return undefined;
      const number = Number(input);
      if (!Number.isInteger(number) || number < min || number > max) throw new Error("invalid number");
      return number;
    };
    const updatedAt = typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
      ? new Date(item.updatedAt).toISOString()
      : undefined;
    return {
      contentType: contentType as LegacyHistoryItem["contentType"],
      contentId,
      episodeId: typeof item.episodeId === "string" ? item.episodeId.slice(0, 64) : undefined,
      seasonNumber: integer(item.seasonNumber ?? item.season, 1, 10_000),
      episodeNumber: integer(item.episodeNumber ?? item.episode, 1, 100_000),
      progressSeconds: Math.min(31_536_000, Math.floor(progressSeconds)),
      durationSeconds: integer(duration, 0, 31_536_000),
      completed: typeof item.completed === "boolean" ? item.completed : undefined,
      updatedAt,
    };
  });
}

export function ProfileHubClient() {
  const locale = useLocale();
  const text = messageFor(locale);
  const queryClient = useQueryClient();
  const { isLoggedIn, isLoading: authLoading, tier } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newAvatar, setNewAvatar] = useState<(typeof AVATARS)[number]>("pistachio");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [order, setOrder] = useState<SupporterPixOrder | null>(null);
  const [copied, setCopied] = useState(false);
  const [legacyItems, setLegacyItems] = useState<LegacyHistoryItem[]>([]);
  const [legacyFileName, setLegacyFileName] = useState("");
  const [legacyError, setLegacyError] = useState("");

  useEffect(() => setActiveId(getActiveProfileId()), []);

  const profiles = useQuery({
    queryKey: queryKeys.viewerProfiles(),
    queryFn: fetchViewerProfiles,
    enabled: isLoggedIn,
  });
  const paymentConfig = useQuery({
    queryKey: queryKeys.supporterConfig(),
    queryFn: fetchSupporterPaymentConfig,
    enabled: isLoggedIn,
  });

  useEffect(() => {
    const available = profiles.data?.profiles ?? [];
    if (!available.length) return;
    if (!activeId || !available.some((profile) => profile.id === activeId)) {
      const fallback = available.find((profile) => profile.isDefault) ?? available[0]!;
      setActiveProfileId(fallback.id);
      setActiveId(fallback.id);
    }
  }, [activeId, profiles.data]);

  const refreshProfiles = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.viewerProfiles() });
  };
  const createProfileMutation = useMutation({
    mutationFn: () => createViewerProfile({ name: newName.trim(), avatarKey: newAvatar }),
    onSuccess: async ({ profile }) => {
      setNewName("");
      setActiveProfileId(profile.id);
      setActiveId(profile.id);
      await refreshProfiles();
    },
  });
  const updateProfileMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateViewerProfile(id, { name }),
    onSuccess: async () => {
      setEditingId(null);
      await refreshProfiles();
    },
  });
  const deleteProfileMutation = useMutation({
    mutationFn: deleteViewerProfile,
    onSuccess: async () => {
      setActiveProfileId(null);
      setActiveId(null);
      await refreshProfiles();
    },
  });
  const createOrderMutation = useMutation({
    mutationFn: () => createSupporterPixOrder(crypto.randomUUID()),
    onSuccess: ({ order: nextOrder }) => setOrder(nextOrder),
  });
  const importHistoryMutation = useMutation({
    mutationFn: () => importLegacyHistory(legacyItems, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["home"] });
      void queryClient.invalidateQueries({ queryKey: ["continue-watching"] });
      void queryClient.invalidateQueries({ queryKey: ["watch-history"] });
    },
  });

  const shouldPoll = Boolean(order && !FINAL_STATUSES.has(order.status));
  const polledOrder = useQuery({
    queryKey: queryKeys.supporterOrder(order?.id ?? "none"),
    queryFn: () => fetchSupporterPixOrder(order!.id),
    enabled: shouldPoll,
    refetchInterval: shouldPoll ? 5_000 : false,
    retry: 2,
  });
  useEffect(() => {
    if (!polledOrder.data?.order) return;
    setOrder(polledOrder.data.order);
    if (polledOrder.data.order.status === "processed") {
      void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.viewerProfiles() });
    }
  }, [polledOrder.data, queryClient]);

  const qrImage = useMemo(() => safeQrImage(order?.qrCodeBase64 ?? null), [order?.qrCodeBase64]);
  const isSupporter = tier === "supporter";

  if (authLoading) {
    return <Skeleton className="mx-auto mt-28 h-[34rem] max-w-6xl rounded-3xl" />;
  }
  if (!isLoggedIn) {
    return (
      <PageTransition>
        <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-5 text-center">
          <UserRound className="h-12 w-12 text-zipo-accent" aria-hidden="true" />
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zipo-text">{text.loginTitle}</h1>
          <p className="mt-3 max-w-md text-zipo-muted">{text.loginText}</p>
          <Link href="/auth/login" className="btn-primary mt-8">{text.login}</Link>
        </main>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <main className="profile-hub mx-auto max-w-[1440px] px-4 pb-24 pt-12 sm:px-6 lg:px-10">
        <header className="max-w-3xl pt-8 sm:pt-12">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zipo-accent">{text.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-zipo-text sm:text-6xl">{text.title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zipo-muted sm:text-lg">{text.subtitle}</p>
        </header>

        <div className="mt-14 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
          <section className="rounded-3xl border border-zipo-border-subtle bg-zipo-surface/70 p-5 sm:p-8" aria-labelledby="profiles-title">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="profiles-title" className="text-2xl font-semibold tracking-tight text-zipo-text">{text.profiles}</h2>
                {profiles.data && <p className="mt-1 text-sm text-zipo-muted">{text.slots(profiles.data.remaining, profiles.data.limit)}</p>}
              </div>
            </div>

            {profiles.isLoading ? (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3"><Skeleton className="h-44 rounded-2xl" /><Skeleton className="h-44 rounded-2xl" /></div>
            ) : profiles.isError ? (
              <p role="alert" className="mt-8 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{profiles.error.message}</p>
            ) : (
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
                {profiles.data?.profiles.map((profile) => {
                  const selected = profile.id === activeId;
                  return (
                    <article key={profile.id} className={cn("group relative rounded-2xl border p-3 transition", selected ? "border-zipo-accent bg-zipo-accent/5" : "border-zipo-border-subtle bg-zipo-bg/45 hover:border-zipo-border")}>
                      <button
                        type="button"
                        onClick={() => { setActiveProfileId(profile.id); setActiveId(profile.id); }}
                        className="w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zipo-accent"
                        aria-pressed={selected}
                      >
                        <span className={cn("flex aspect-square items-center justify-center rounded-xl", avatarClass(profile.avatarKey))}>
                          <UserRound className="h-12 w-12" strokeWidth={1.5} aria-hidden="true" />
                        </span>
                        <span className="mt-3 block truncate text-sm font-semibold text-zipo-text">{profile.name}</span>
                        <span className="mt-1 flex min-h-5 gap-2 text-[11px] uppercase tracking-wider text-zipo-muted">
                          {selected && <span className="text-zipo-accent">{text.active}</span>}
                          {profile.isDefault && <span>{text.default}</span>}
                        </span>
                      </button>
                      <div className="mt-2 flex gap-1 border-t border-zipo-border-subtle pt-2">
                        <button type="button" onClick={() => { setEditingId(profile.id); setEditingName(profile.name); }} className="flex h-10 flex-1 items-center justify-center rounded-lg text-zipo-muted hover:bg-zipo-elevated hover:text-zipo-text" aria-label={`${text.save}: ${profile.name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                        {!profile.isDefault && (
                          <button type="button" onClick={() => window.confirm(text.removeConfirm) && deleteProfileMutation.mutate(profile.id)} className="flex h-10 flex-1 items-center justify-center rounded-lg text-zipo-muted hover:bg-red-400/10 hover:text-red-300" aria-label={`${text.remove}: ${profile.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {editingId && (
              <form className="mt-6 flex flex-col gap-3 rounded-2xl border border-zipo-border-subtle bg-zipo-bg/60 p-4 sm:flex-row" onSubmit={(event) => { event.preventDefault(); const name = editingName.trim(); if (name) updateProfileMutation.mutate({ id: editingId, name }); }}>
                <input name="profile-name" autoComplete="off" value={editingName} onChange={(event) => setEditingName(event.target.value)} maxLength={40} className="min-h-11 min-w-0 flex-1 rounded-xl border border-zipo-border bg-zipo-bg px-4 text-zipo-text outline-none focus:border-zipo-accent" aria-label={text.name} />
                <button type="submit" disabled={!editingName.trim() || updateProfileMutation.isPending} className="btn-primary">{text.save}</button>
                <button type="button" onClick={() => setEditingId(null)} className="btn-secondary">{text.cancel}</button>
              </form>
            )}

            {Boolean(profiles.data?.remaining) && (
              <form className="mt-8 border-t border-zipo-border-subtle pt-8" onSubmit={(event) => { event.preventDefault(); if (newName.trim()) createProfileMutation.mutate(); }}>
                <h3 className="font-semibold text-zipo-text">{text.newProfile}</h3>
                <div className="mt-4 flex gap-2" aria-label="Avatar">
                  {AVATARS.map((avatar) => (
                    <button key={avatar} type="button" onClick={() => setNewAvatar(avatar)} className={cn("flex h-11 w-11 items-center justify-center rounded-full ring-offset-2 ring-offset-zipo-surface", avatarClass(avatar), newAvatar === avatar && "ring-2 ring-zipo-accent")} aria-label={avatar} aria-pressed={newAvatar === avatar}>{newAvatar === avatar && <Check className="h-4 w-4" />}</button>
                  ))}
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <input name="new-profile-name" autoComplete="off" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={40} placeholder={`${text.name}…`} aria-label={text.name} className="min-h-12 min-w-0 flex-1 rounded-xl border border-zipo-border bg-zipo-bg px-4 text-zipo-text outline-none placeholder:text-zipo-muted focus:border-zipo-accent" />
                  <button type="submit" disabled={!newName.trim() || createProfileMutation.isPending} className="btn-primary min-h-12 disabled:opacity-50">
                    {createProfileMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{text.create}
                  </button>
                </div>
                {createProfileMutation.isError && <p role="alert" className="mt-3 text-sm text-red-300">{createProfileMutation.error.message}</p>}
              </form>
            )}

            <div className="mt-8 border-t border-zipo-border-subtle pt-8">
              <h3 className="font-semibold text-zipo-text">{text.importTitle}</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zipo-muted">{text.importText}</p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="btn-secondary cursor-pointer">
                  {text.importChoose}
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      setLegacyItems([]);
                      setLegacyError("");
                      if (!file || file.size > 2_000_000) { setLegacyError(text.importInvalid); return; }
                      try {
                        const parsed = parseLegacyHistory(JSON.parse(await file.text()));
                        setLegacyItems(parsed);
                        setLegacyFileName(file.name);
                      } catch {
                        setLegacyError(text.importInvalid);
                      }
                    }}
                  />
                </label>
                {legacyItems.length > 0 && (
                  <button type="button" onClick={() => importHistoryMutation.mutate()} disabled={importHistoryMutation.isPending} className="btn-primary">
                    {importHistoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{text.importAction}
                  </button>
                )}
                {legacyItems.length > 0 && <span className="truncate text-sm text-zipo-muted" title={legacyFileName}>{text.importReady(legacyItems.length)}</span>}
              </div>
              {legacyError && <p role="alert" className="mt-3 text-sm text-red-300">{legacyError}</p>}
              {importHistoryMutation.isError && <p role="alert" className="mt-3 text-sm text-red-300">{importHistoryMutation.error.message}</p>}
              {importHistoryMutation.data && <p role="status" className="mt-3 text-sm text-zipo-accent">{text.importDone(importHistoryMutation.data.importedCount)}</p>}
            </div>
          </section>

          <aside className="relative overflow-hidden rounded-3xl border border-zipo-accent/30 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--zipo-accent)_17%,var(--zipo-surface)),var(--zipo-surface)_48%)] p-6 text-zipo-text shadow-[0_28px_80px_var(--zipo-shadow)] sm:p-8">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-zipo-accent to-transparent" aria-hidden="true" />
            <Crown className="h-8 w-8 text-zipo-accent" aria-hidden="true" />
            <h2 className="mt-10 text-3xl font-semibold leading-tight tracking-[-0.04em]">{isSupporter ? text.alreadySupporter : text.supporterTitle}</h2>
            <p className="mt-4 text-sm leading-6 text-zipo-text-secondary">{isSupporter ? text.supporterBenefit : text.supporterText}</p>

            {isSupporter ? (
              <div className="mt-8 flex items-center gap-3 rounded-2xl bg-zipo-accent/10 p-4 text-zipo-accent"><CheckCircle2 className="h-6 w-6" /><span className="font-semibold">{text.alreadySupporter}</span></div>
            ) : paymentConfig.isLoading ? (
              <Loader2 className="mt-10 h-6 w-6 animate-spin" />
            ) : !paymentConfig.data?.enabled || paymentConfig.data.amountCents == null ? (
              <p className="mt-8 rounded-2xl border border-zipo-border-subtle bg-zipo-elevated p-4 text-sm text-zipo-muted">{text.unavailable}</p>
            ) : !order ? (
              <button type="button" onClick={() => createOrderMutation.mutate()} disabled={createOrderMutation.isPending} className="mt-8 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-zipo-accent px-5 font-semibold text-[var(--zipo-on-accent)] transition-colors hover:bg-zipo-accent-hover disabled:opacity-60">
                {createOrderMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {text.generatePix} · {formatBrl(paymentConfig.data.amountCents, locale)}
              </button>
            ) : (
              <div className="mt-8 rounded-2xl border border-zipo-border-subtle bg-zipo-elevated p-4 text-zipo-text">
                <h3 className="font-semibold">{text.pixTitle}</h3>
                <p className="mt-1 text-xs leading-5 text-zipo-muted">{text.pixInstructions}</p>
                {qrImage && <Image src={qrImage} alt="QR Code Pix" width={220} height={220} unoptimized className="mx-auto mt-4 aspect-square w-full max-w-[220px] rounded-lg bg-white p-2" />}
                {order.qrCode && (
                  <button type="button" onClick={async () => { await navigator.clipboard.writeText(order.qrCode!); setCopied(true); window.setTimeout(() => setCopied(false), 2_000); }} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-zipo-border px-3 text-sm font-semibold hover:border-zipo-accent/50 hover:bg-zipo-accent/5">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? text.copied : text.copyCode}
                  </button>
                )}
                {order.ticketUrl && <a href={order.ticketUrl} target="_blank" rel="noopener noreferrer" className="mt-2 flex min-h-11 items-center justify-center gap-2 text-sm font-semibold underline underline-offset-4">{text.openPayment}<ExternalLink className="h-4 w-4" /></a>}
                <p className="mt-4 flex items-center gap-2 border-t border-zipo-border-subtle pt-4 text-sm font-semibold" aria-live="polite">
                  {order.status === "processed" ? <CheckCircle2 className="h-5 w-5" /> : <Loader2 className={cn("h-5 w-5", shouldPoll && "animate-spin")} />}
                  {order.status === "processed" ? text.approved : text.pending}
                </p>
              </div>
            )}
            {createOrderMutation.isError && <p role="alert" className="mt-4 text-sm font-medium text-red-300">{text.paymentFailed} {createOrderMutation.error.message}</p>}
          </aside>
        </div>
      </main>
    </PageTransition>
  );
}
