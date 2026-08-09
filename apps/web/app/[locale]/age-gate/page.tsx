"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { useRouter } from "@/i18n/routing";
import { confirmAdult } from "@/lib/account";
import { isNsfwSite, siteDisplayName } from "@/lib/site-mode";

export default function AgeGatePage() {
  const t = useTranslations("ageGate");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNsfwSite()) router.replace("/");
  }, [router]);

  if (!isNsfwSite()) return null;

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmAdult();
      router.replace("/");
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nsfw-age-stage">
      <div className="nsfw-age-card">
        <span className="nsfw-badge-18 mx-auto mb-5">18+</span>
        <ShieldAlert className="mx-auto mb-4 h-11 w-11 text-zipo-accent" aria-hidden="true" />
        <p className="text-[0.68rem] font-bold uppercase tracking-[0.28em] text-zipo-accent">
          {siteDisplayName()}
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-zipo-text sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zipo-muted">{t("description")}</p>
        {error && <p className="mt-4 text-sm text-zipo-accent">{error}</p>}
        <div className="mt-8 flex w-full flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            className="btn-primary min-h-11 flex-1 px-6"
            disabled={busy}
            onClick={() => void onConfirm()}
          >
            {busy ? t("confirming") : t("confirm")}
          </button>
          <button
            type="button"
            className="btn-secondary min-h-11 flex-1 px-6"
            disabled={busy}
            onClick={() => router.push("/auth/login")}
          >
            {t("leave")}
          </button>
        </div>
      </div>
    </div>
  );
}
