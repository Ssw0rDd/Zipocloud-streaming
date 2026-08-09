import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";
import { parseImageHostAllowlist } from "@zipo/shared";
import { secureEmbedOrigins } from "./lib/security-policy";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");
const workspaceRoot = path.resolve(__dirname, "../..");

const isDevelopment = process.env.NODE_ENV === "development";
const isNsfwBuild =
  process.env.NEXT_PUBLIC_SITE_MODE?.trim().toLowerCase() === "nsfw";
// Main + NSFW must never share a distDir: NEXT_PUBLIC_* is inlined at compile
// time, and two concurrent `next dev` processes corrupt HMR/chunk state.
const distDir = isDevelopment
  ? isNsfwBuild
    ? ".next-dev-nsfw"
    : ".next-dev"
  : isNsfwBuild
    ? ".next-nsfw"
    : ".next";
const remoteImageHosts = parseImageHostAllowlist(process.env.NEXT_IMAGE_HOSTS);

const embedOrigins = secureEmbedOrigins();
const secureEmbedPermissions = embedOrigins.map((origin) => `"${origin}"`).join(" ");

const nextConfig: NextConfig = {
  output: "standalone",
  productionBrowserSourceMaps: false,
  // CI runs ESLint as a dedicated blocking gate before build. Avoid Next's
  // legacy nested ESLint resolver running the same work with pnpm isolation.
  eslint: { ignoreDuringBuilds: true },
  distDir,
  outputFileTracingRoot: workspaceRoot,
  turbopack: { root: workspaceRoot },
  // Cloudflare quick tunnel — permite assets /_next em dev via domínio público
  allowedDevOrigins: ["*.trycloudflare.com"],
  transpilePackages: ["@zipo/api-client", "@zipo/shared"],
  images: {
    remotePatterns: [
      ...remoteImageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
      ...(isDevelopment ? [{ protocol: "http" as const, hostname: "localhost" }] : []),
    ],
  },
  async rewrites() {
    // Sempre proxy para API local — nunca usar URL pública do tunnel aqui
    const apiUrl = process.env.API_URL ?? "http://localhost:3001";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          {
            key: "Permissions-Policy",
            value:
              `camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(self), autoplay=(self \"https://www.youtube-nocookie.com\"${secureEmbedPermissions ? ` ${secureEmbedPermissions}` : ""}), fullscreen=(self \"https://www.youtube-nocookie.com\"${secureEmbedPermissions ? ` ${secureEmbedPermissions}` : ""})`,
          },
          ...(!isDevelopment
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
