import { nanoid } from "nanoid";
import { z } from "zod";
import type { EmbedSource } from "@zipo/shared";
import { env } from "../env";
import { isSafeEmbedUrl, resolvesToPublicAddresses } from "../lib/ssrf";
import type { PlaybackContext } from "../playback/types";
import {
  createAuthorizedMediaSession,
  megaFlixMediaOrigins,
  signAuthorizedResolverPayload,
  validateAuthorizedMediaUrl,
  verifyAuthorizedResolverResponse,
  type AuthorizedSource,
} from "./authorized-media";

const MAX_RESPONSE_BYTES = 1_000_000;
const responseSchema = z.object({
  version: z.literal(2),
  sources: z.array(z.object({
    type: z.enum(["hls", "mp4"]),
    url: z.string().url().max(4_096),
    label: z.string().trim().min(1).max(80).optional(),
    quality: z.string().trim().min(1).max(32).optional(),
    language: z.string().trim().min(1).max(24).optional(),
    expiresAt: z.string().max(64).optional(),
  }).strict()).max(12),
}).strict();

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_RESPONSE_BYTES) throw new Error("Gateway response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Gateway response is too large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

function gatewayUrl(): URL | null {
  if (!env.MEGAFLIX_GATEWAY_ENABLED || !env.MEGAFLIX_GATEWAY_SECRET) return null;
  try {
    const url = new URL(env.MEGAFLIX_GATEWAY_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !isSafeEmbedUrl(url.toString()) ||
      megaFlixMediaOrigins().length === 0
    ) return null;
    return url;
  } catch {
    return null;
  }
}

export function megaFlixGatewayConfigured(): boolean {
  return gatewayUrl() != null;
}

export function validateMegaFlixGatewayResponse(input: {
  timestamp: string;
  nonce: string;
  raw: string;
  signature: string | null;
  secret: string;
  origins: string[];
}): AuthorizedSource[] {
  if (!verifyAuthorizedResolverResponse(
    input.timestamp,
    input.nonce,
    input.raw,
    input.signature,
    input.secret,
  )) return [];
  try {
    const parsed = responseSchema.safeParse(JSON.parse(input.raw));
    if (!parsed.success) return [];
    return parsed.data.sources.filter(
      (source) => validateAuthorizedMediaUrl(source.url, input.origins) != null,
    );
  } catch {
    return [];
  }
}

async function resolveGatewaySources(context: PlaybackContext): Promise<AuthorizedSource[]> {
  const url = gatewayUrl();
  const secret = env.MEGAFLIX_GATEWAY_SECRET;
  if (!url || !secret) return [];
  if (!await resolvesToPublicAddresses(url)) return [];
  const body = JSON.stringify({
    version: 2,
    requestId: nanoid(24),
    content: {
      type: context.type,
      id: context.id,
      title: context.title,
      alternativeTitles: context.alternativeTitles,
      year: context.year,
      imdbId: context.imdbId,
      tmdbId: context.tmdbId,
      season: context.season,
      episode: context.episode,
      episodeTitle: context.episodeTitle,
      episodeAirDate: context.episodeAirDate,
    },
    preferences: {
      audioLanguage: context.audioLang,
      subtitleLanguage: context.subtitleLang,
    },
  });
  const timestamp = String(Date.now());
  const nonce = nanoid(24);
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ZiPo-MegaFlix/2.0",
      "X-ZiPo-Timestamp": timestamp,
      "X-ZiPo-Nonce": nonce,
      "X-ZiPo-Signature": signAuthorizedResolverPayload(
        "request",
        timestamp,
        nonce,
        body,
        secret,
      ),
    },
    body,
    signal: AbortSignal.timeout(env.MEGAFLIX_GATEWAY_TIMEOUT_MS),
  });
  if (!response.ok || response.status >= 300) return [];
  const raw = await readLimitedText(response);
  const origins = megaFlixMediaOrigins();
  return validateMegaFlixGatewayResponse({
    timestamp,
    nonce,
    raw,
    signature: response.headers.get("x-zipo-response-signature"),
    secret,
    origins,
  });
}

export async function resolveMegaFlixGateway(context: PlaybackContext): Promise<EmbedSource[]> {
  const origins = megaFlixMediaOrigins();
  const sources = await resolveGatewaySources(context);
  const resolved = await Promise.all(sources.map(async (source, index) => {
    try {
      const session = await createAuthorizedMediaSession(source, origins);
      return {
        type: source.type,
        url: session.url,
        label: source.label ?? `MegaFlix ${source.language ?? "BR"} ${source.quality ?? `Servidor ${index + 1}`}`,
        quality: source.quality,
        providerId: "megaflix",
        capabilities: {
          mode: "native" as const,
          handoffToProvider: false,
          supportsQualitySwitch: source.type === "hls",
          supportsAutoFallback: true,
        },
      };
    } catch {
      return null;
    }
  }));
  return resolved.filter((source): source is NonNullable<typeof source> => source != null);
}

export async function getMegaFlixGatewayHealth(): Promise<
  "up" | "down" | "disabled" | "unconfigured"
> {
  if (!env.MEGAFLIX_GATEWAY_ENABLED) return "disabled";
  return megaFlixGatewayConfigured() ? "up" : "unconfigured";
}
