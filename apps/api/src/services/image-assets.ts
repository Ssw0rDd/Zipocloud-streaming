import { nanoid } from "nanoid";
import sharp from "sharp";
import {
  imageCandidates,
  isAllowedNextImageHost,
  parseImageHostAllowlist,
  type ContentItem,
  type MediaImage,
  type MediaImageKind,
} from "@zipo/shared";
import { env } from "../env";
import { cacheGet, cacheSet } from "../lib/redis";
import { isSafeEmbedUrl, rejectUnsafeUrl } from "../lib/ssrf";
import { putMediaObject, readMediaObject } from "../media/storage";

const ASSET_KEY_PREFIX = "img:asset:v1:";
const NEGATIVE_KEY_PREFIX = "img:neg:v1:";
const ASSET_TTL_SECONDS = 7 * 24 * 60 * 60;
const NEGATIVE_TTL_SECONDS = 5 * 60;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const ASSET_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Hosts allowed for upstream image fetches — same source as NEXT_IMAGE_HOSTS / shared defaults. */
export const ALLOWED_IMAGE_HOSTS = new Set(
  parseImageHostAllowlist(process.env.NEXT_IMAGE_HOSTS),
);

export interface ImageAssetRecord {
  upstreamUrl: string;
  kind: MediaImageKind;
  source: string;
}

export type DetectedImageMime = "jpeg" | "png" | "webp" | "gif";

export function isAllowedImageHost(urlString: string): boolean {
  if (!isSafeEmbedUrl(urlString)) return false;
  return isAllowedNextImageHost(urlString, [...ALLOWED_IMAGE_HOSTS]);
}

export function detectImageMime(bytes: Uint8Array): DetectedImageMime | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "gif";
  }
  // RIFF....WEBP
  const riff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46;
  const webp =
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  if (riff && webp) return "webp";
  return null;
}

function assetKey(id: string): string {
  return `${ASSET_KEY_PREFIX}${id}`;
}

function negativeKey(id: string): string {
  return `${NEGATIVE_KEY_PREFIX}${id}`;
}

function storageKeyFor(assetId: string, format: "webp" | "avif"): string {
  return `images/${assetId}.${format}`;
}

function maxDimensionFor(kind: MediaImageKind): number {
  // Poster covers need higher source density for detail hero + ranked rails.
  if (kind === "backdrop") return 1280;
  if (kind === "poster") return 900;
  return 640;
}

export async function registerImageAsset(
  upstreamUrl: string,
  kind: MediaImageKind,
  source: string,
): Promise<MediaImage | null> {
  const safety = rejectUnsafeUrl(upstreamUrl);
  if (!safety.ok || !isAllowedImageHost(upstreamUrl)) return null;

  const id = nanoid(21);
  const record: ImageAssetRecord = { upstreamUrl, kind, source };
  await cacheSet(assetKey(id), record, ASSET_TTL_SECONDS);

  return {
    id,
    url: `/api/v1/images/${id}`,
    kind,
    format: "webp",
    source,
  };
}

export async function getImageAsset(assetId: string): Promise<ImageAssetRecord | null> {
  if (!ASSET_ID_RE.test(assetId)) return null;
  return cacheGet<ImageAssetRecord>(assetKey(assetId));
}

export async function isNegativeCached(assetId: string): Promise<boolean> {
  if (!ASSET_ID_RE.test(assetId)) return false;
  const hit = await cacheGet<string>(negativeKey(assetId));
  return hit != null;
}

async function setNegativeCache(assetId: string): Promise<void> {
  await cacheSet(negativeKey(assetId), "1", NEGATIVE_TTL_SECONDS);
}

async function fetchUpstreamBytes(url: string): Promise<Uint8Array> {
  let current = url;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const safety = rejectUnsafeUrl(current);
    if (!safety.ok || !isAllowedImageHost(current)) {
      throw new Error("UNSAFE_UPSTREAM");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "image/*,*/*;q=0.8" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) {
          throw new Error("REDIRECT_LIMIT");
        }
        current = new URL(location, current).toString();
        continue;
      }

      if (!res.ok) throw new Error(`UPSTREAM_${res.status}`);

      const contentLength = Number(res.headers.get("content-length") ?? 0);
      if (contentLength > MAX_BYTES) throw new Error("TOO_LARGE");

      const buffer = new Uint8Array(await res.arrayBuffer());
      if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
        throw new Error("TOO_LARGE");
      }
      return buffer;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("REDIRECT_LIMIT");
}

export async function processImageBytes(
  input: Uint8Array,
  kind: MediaImageKind,
  preferAvif: boolean,
): Promise<{ body: Uint8Array; format: "webp" | "avif"; contentType: string; width?: number; height?: number }> {
  const mime = detectImageMime(input);
  if (!mime) throw new Error("INVALID_MIME");

  const maxDim = maxDimensionFor(kind);
  let pipeline = sharp(input, { limitInputPixels: 40_000_000, sequentialRead: true })
    .rotate()
    .resize({
      width: maxDim,
      height: maxDim,
      fit: "inside",
      withoutEnlargement: true,
    });

  // Strip metadata by not calling withMetadata
  if (preferAvif) {
    try {
      const body = await pipeline.avif({ quality: 55 }).toBuffer();
      const meta = await sharp(body).metadata();
      return {
        body,
        format: "avif",
        contentType: "image/avif",
        width: meta.width,
        height: meta.height,
      };
    } catch {
      pipeline = sharp(input, { limitInputPixels: 40_000_000, sequentialRead: true })
        .rotate()
        .resize({
          width: maxDim,
          height: maxDim,
          fit: "inside",
          withoutEnlargement: true,
        });
    }
  }

  const body = await pipeline.webp({ quality: 78 }).toBuffer();
  const meta = await sharp(body).metadata();
  return {
    body,
    format: "webp",
    contentType: "image/webp",
    width: meta.width,
    height: meta.height,
  };
}

export async function serveImageAsset(
  assetId: string,
  acceptHeader?: string | null,
): Promise<
  | { ok: true; body: Uint8Array; contentType: string; format: "webp" | "avif" }
  | { ok: false; status: 404 | 503; code: string }
> {
  if (!env.IMAGE_PIPELINE_V2) {
    return { ok: false, status: 404, code: "PIPELINE_DISABLED" };
  }
  if (!ASSET_ID_RE.test(assetId)) {
    return { ok: false, status: 404, code: "NOT_FOUND" };
  }
  if (await isNegativeCached(assetId)) {
    return { ok: false, status: 404, code: "NOT_FOUND" };
  }

  const record = await getImageAsset(assetId);
  if (!record) {
    return { ok: false, status: 404, code: "NOT_FOUND" };
  }

  const preferAvif = Boolean(acceptHeader?.includes("image/avif"));

  for (const format of preferAvif ? (["avif", "webp"] as const) : (["webp"] as const)) {
    try {
      const cached = await readMediaObject(storageKeyFor(assetId, format));
      return {
        ok: true,
        body: cached.body,
        contentType: cached.contentType || (format === "avif" ? "image/avif" : "image/webp"),
        format,
      };
    } catch {
      // miss — continue
    }
  }

  try {
    const upstream = await fetchUpstreamBytes(record.upstreamUrl);
    const processed = await processImageBytes(upstream, record.kind, preferAvif);
    await putMediaObject({
      key: storageKeyFor(assetId, processed.format),
      body: processed.body,
      contentType: processed.contentType,
    });
    // Redis hint that object is ready (optional soft cache)
    await cacheSet(
      `img:ready:v1:${assetId}:${processed.format}`,
      "1",
      ASSET_TTL_SECONDS,
    );
    return {
      ok: true,
      body: processed.body,
      contentType: processed.contentType,
      format: processed.format,
    };
  } catch (err) {
    console.warn(
      `[image-assets] failed ${assetId}:`,
      err instanceof Error ? err.message : err,
    );
    await setNegativeCache(assetId);
    return { ok: false, status: 404, code: "NOT_FOUND" };
  }
}

export async function rewriteContentItemImages(item: ContentItem): Promise<ContentItem> {
  if (!env.IMAGE_PIPELINE_V2) return item;

  const images: NonNullable<ContentItem["images"]> = { ...item.images };
  let poster = item.poster;
  let backdrop = item.backdrop;

  if (item.poster) {
    const media = await registerImageAsset(item.poster, "poster", "content");
    if (media) {
      images.poster = media;
      poster = media.url;
    }
  }
  if (item.backdrop) {
    const media = await registerImageAsset(item.backdrop, "backdrop", "content");
    if (media) {
      images.backdrop = media;
      backdrop = media.url;
    }
  }

  const stillSources = (item.stillCandidates ?? []).slice(0, 4);
  const stillUrls: string[] = [];
  if (stillSources.length > 0) {
    const stills: MediaImage[] = [];
    for (const url of stillSources) {
      const media = await registerImageAsset(url, "still", "content");
      if (media) {
        stills.push(media);
        stillUrls.push(media.url);
      }
    }
    if (stills.length) images.stills = stills;
  }

  return {
    ...item,
    poster,
    backdrop,
    // Prefer gateway URLs first so the client does not hit CSP-blocked upstream hosts.
    posterCandidates: imageCandidates(poster, backdrop, ...(item.posterCandidates ?? [])),
    stillCandidates: imageCandidates(...stillUrls, ...(item.stillCandidates ?? [])),
    images: Object.keys(images).length ? images : item.images,
  };
}

export async function rewriteContentItemList(items: ContentItem[]): Promise<ContentItem[]> {
  if (!env.IMAGE_PIPELINE_V2) return items;
  return Promise.all(items.map((item) => rewriteContentItemImages(item)));
}
