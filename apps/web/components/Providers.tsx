"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import type { UserTier } from "@zipo/shared";
import { CATALOG_STALE_TIME } from "@/lib/query-config";
import { AdBlockProvider } from "@/components/ads/AdBlockGate";
import { AdsProvider } from "@/components/ads/AdsContext";
import { PwaRegister } from "@/components/PwaRegister";
import { WebVitalsReporter } from "@/components/WebVitalsReporter";

interface ProvidersProps {
  children: ReactNode;
  userTier?: UserTier;
}

export function Providers({ children, userTier = "guest" }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: CATALOG_STALE_TIME,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider attribute="data-theme" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <AdsProvider userTier={userTier}>
          <AdBlockProvider userTier={userTier}>
            <PwaRegister />
            <WebVitalsReporter />
            {children}
          </AdBlockProvider>
        </AdsProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
