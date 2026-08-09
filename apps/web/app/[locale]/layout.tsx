import { Bricolage_Grotesque, Manrope } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { Providers } from "@/components/Providers";
import { LayoutShell } from "@/components/LayoutShell";
import { isNsfwSite, siteDisplayName } from "@/lib/site-mode";
import "../globals.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const nsfw = isNsfwSite();
const brand = siteDisplayName();

// A fresh CSP nonce is attached by middleware for every document response.
// Dynamic rendering is required for Next.js to propagate that nonce to scripts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  applicationName: brand,
  title: {
    default: nsfw
      ? `${brand} — Conteúdo adulto (+18)`
      : "ZiPo — Filmes, séries e animes",
    template: `%s · ${brand}`,
  },
  description: nsfw
    ? "Catálogo adulto (+18): filmes, séries e animes. Login e confirmação de idade obrigatórios."
    : "Descubra e assista filmes, séries e animes em um player nativo.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/zipo-icon.svg", apple: "/zipo-icon.svg" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: brand,
  },
  formatDetection: { telephone: false },
  ...(nsfw
    ? {
        robots: { index: false, follow: false, nocache: true },
      }
    : {}),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1ed" },
    { media: "(prefers-color-scheme: dark)", color: "#08090b" },
  ],
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  // Reading request headers prevents static prerendering, ensuring the HTML and
  // the response CSP are generated from the same middleware nonce.
  await headers();
  const { locale } = await params;
  if (!routing.locales.includes(locale as Locale)) notFound();

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${bricolage.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <body className={`${nsfw ? "site-nsfw " : ""}flex min-h-screen flex-col antialiased`}>
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <LayoutShell isNsfw={nsfw}>{children}</LayoutShell>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
