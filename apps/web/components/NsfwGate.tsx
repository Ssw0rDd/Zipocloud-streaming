"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "@/i18n/routing";
import { useAuth } from "@/hooks/useAuth";
import { fetchAccountMe } from "@/lib/account";

const AUTH_PREFIXES = ["/auth/login", "/auth/register"];
const AGE_GATE = "/age-gate";

export function NsfwGate({
  children,
  enabled = false,
}: {
  children: React.ReactNode;
  /** Passed from LayoutShell (server-derived). Avoid client env reads here. */
  enabled?: boolean;
}) {
  const { isLoggedIn, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [checking, setChecking] = useState(enabled);
  const [allowed, setAllowed] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setAllowed(true);
      setChecking(false);
      return;
    }

    const onAuthPage = AUTH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
    const onAgeGate = pathname.startsWith(AGE_GATE);

    if (isLoading) {
      setChecking(true);
      return;
    }

    if (!isLoggedIn) {
      setAllowed(onAuthPage);
      setChecking(false);
      if (!onAuthPage) router.replace("/auth/login");
      return;
    }

    let cancelled = false;
    setChecking(true);
    void fetchAccountMe()
      .then((me) => {
        if (cancelled) return;
        if (!me.adultConfirmed) {
          setAllowed(onAgeGate || onAuthPage);
          if (!onAgeGate && !onAuthPage) router.replace(AGE_GATE);
        } else {
          setAllowed(true);
          if (onAgeGate) router.replace("/");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAllowed(onAuthPage);
        if (!onAuthPage) router.replace("/auth/login");
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, isLoading, isLoggedIn, pathname, router]);

  if (!enabled) return children;
  if (checking || !allowed) {
    return (
      <div className="nsfw-loading" role="status" aria-live="polite">
        Carregando…
      </div>
    );
  }
  return children;
}
