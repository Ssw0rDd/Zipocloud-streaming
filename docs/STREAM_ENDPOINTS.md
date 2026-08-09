# Stream endpoint and token map

Scope: contracts implemented in this repository. Provider-managed iframe internals are intentionally recorded as opaque: the repository has no first-party contract for their private media routes, tokens, cookies, or DRM keys.

## Phase 1 — endpoint mapping

### A. Provider-managed embeds

All entries below are HTTPS `GET`, take no required `Authorization`, `Cookie`, `Origin`, or `Referer` header in the ZiPo adapter, and return provider-owned HTML intended for an iframe. URL fragments are client-side player options and are not sent over HTTP.

| Provider / exact base | Required path and parameters | ZiPo response contract |
| --- | --- | --- |
| `https://player.videasy.net` | `/movie/{tmdbId}?color=16a34a&overlay=true`; `/tv/{tmdbId}/{season}/{episode}?color=16a34a&overlay=true&nextEpisode=true`; `/anime/{anilistId}[/{episode}]?color=16a34a&overlay=true` | `EmbedSource { type: "iframe", url }` |
| `https://www.vidking.net` | `/embed/movie/{tmdbId}?color=16a34a`; `/embed/tv/{tmdbId}/{season}/{episode}?color=16a34a&nextEpisode=true` | iframe URL |
| `https://vidlink.pro` | `/movie/{tmdbId}`, `/tv/{tmdbId}/{season}/{episode}`, `/anime/{malId}/{episode}/{sub|dub}` plus documented appearance query | iframe URL |
| `https://vidsrc.win` | `/watch/{tmdbId}`; series adds `?s={season}&e={episode}` | iframe URL |
| `https://www.2embed.cc` | `/embed/{tmdbOrImdbId}`; series uses `/embedtv/{id}&s={season}&e={episode}` | iframe URL |
| `https://superflixapi.pro` | `/filme/{tmdbOrImdbId}` or `/serie/{tmdbId}/{season}/{episode}` plus `#noEpList#noLink#transparent#color:16a34a` | iframe URL |
| `https://warezcdn.lat` | Same path contract as SuperFlix | iframe URL |

Flow for every row: `POST /api/v2/playback/embeds` → adapter builds the HTTPS iframe URL → browser navigates the iframe → provider owns every subsequent hop. No supported ZiPo function resolves that iframe to a raw URL, so HLS/DASH/MP4/DRM classification and raw-stream curl are `provider-managed / not asserted`.

HTML contract smoke test:

```bash
curl --fail --location --proto '=https' --tlsv1.2 \
  'https://player.videasy.net/movie/[TMDB_ID]?color=16a34a&overlay=true'
```

### B. First-party/authorized resolvers

| Endpoint | Method | Required authentication | Request | Response / next hop |
| --- | --- | --- | --- | --- |
| `[AUTHORIZED_MEDIA_RESOLVER_URL]` | POST | `X-ZiPo-Timestamp`, `X-ZiPo-Nonce`, `X-ZiPo-Signature=HMAC-SHA256(secret, request:timestamp:nonce:body)` | JSON v1 content + preferences | Signed JSON `{ sources: [{ type: "hls"|"mp4", url, expiresAt? }] }` |
| `[MEGAFLIX_GATEWAY_URL]` | POST | Same signed headers with `[MEGAFLIX_GATEWAY_SECRET]` | JSON v2 with `requestId`, content and preferences | Signed JSON v2 `sources`; exact source origins must be allowlisted |
| `/api/v1/playback/media/authorized/{token}/master.m3u8` | GET | Opaque Redis-backed path token | none | Rewritten HLS manifest; every URI, including `EXT-X-KEY`, becomes a same-origin opaque `/r/{sealed}` path |
| `/api/v1/playback/media/authorized/{token}/file.mp4` | GET | Opaque path token; optional `Range` | none | Proxied MP4, status 200/206 |
| `/api/v1/playback/media/authorized/{token}/r/{sealed}` | GET | Opaque session token + AES-GCM-sealed resource path | optional `Range` | HLS child manifest, segment, init file, or authorized key bytes |
| `/api/v2/playback/preparations/{id}/master.m3u8?token={token}` | GET | Preparation token | none | First-party VOD HLS manifest |
| `/api/v2/playback/preparations/{id}/{segment-file}?token={token}` | GET | Preparation token | none | MPEG-TS segment |

Resolver flow: ZiPo signs request → resolver returns signed, allowlisted HLS/MP4 URL → ZiPo creates a random 10-minute media session → local proxy rewrites all HLS resources → browser consumes only same-origin paths. Redirects are rejected. The schemas reject DASH, blob URLs, and arbitrary origins.

Signed resolver request:

```bash
curl --fail --request POST '[AUTHORIZED_MEDIA_RESOLVER_URL]' \
  --header 'Content-Type: application/json' \
  --header 'X-ZiPo-Timestamp: [TIMESTAMP_MS]' \
  --header 'X-ZiPo-Nonce: [NONCE]' \
  --header 'X-ZiPo-Signature: [BASE64URL_HMAC_SHA256]' \
  --data-binary '[CANONICAL_JSON_BODY]'
```

Same-origin HLS/MP4 requests:

```bash
curl --fail --header 'Range: bytes=0-' \
  'https://[ZIPO_DOMAIN]/api/v1/playback/media/authorized/[MEDIA_TOKEN]/file.mp4' \
  --output video.mp4

curl --fail \
  'https://[ZIPO_DOMAIN]/api/v1/playback/media/authorized/[MEDIA_TOKEN]/master.m3u8'
```

### C. Protected sequential delivery

| Endpoint | Method | Required authentication | Response |
| --- | --- | --- | --- |
| `/api/stream/init/{videoId}` | GET | Better Auth session cookie; `X-Client-Public-Key` = raw uncompressed P-256 public key in base64url | `{ sessionToken, totalSegments, expiresAt, manifestUrl, serverPublicKey, wrappedSessionKey, keyWrapIv }` |
| `/api/stream/manifest/{videoId}` | GET | `Authorization: Bearer {sessionToken}` | VOD HLS manifest containing sequential local segment URLs |
| `/api/stream/segment/{videoId}/{index}` | GET | Bearer token; index must equal Redis `nextSegment` | AES-256-GCM ciphertext + tag, `X-Segment-IV`, `application/octet-stream` |

Flow: authenticated init → 30-minute signed token bound to user/video/nonce → ephemeral P-256 ECDH key wrap → HLS manifest → one atomic sequential claim per segment → AES-GCM ciphertext → in-memory WebCrypto decryption → hls.js transmux/SourceBuffer.

```bash
curl --fail --cookie '[BETTER_AUTH_COOKIE]' \
  --header 'X-Client-Public-Key: [CLIENT_P256_PUBLIC_KEY_BASE64URL]' \
  'https://[ZIPO_DOMAIN]/api/stream/init/[VIDEO_ID]'

curl --fail --header 'Authorization: Bearer [SESSION_TOKEN]' \
  'https://[ZIPO_DOMAIN]/api/stream/manifest/[VIDEO_ID]'

curl --fail --header 'Authorization: Bearer [SESSION_TOKEN]' \
  --dump-header segment.headers \
  'https://[ZIPO_DOMAIN]/api/stream/segment/[VIDEO_ID]/0' \
  --output segment-000000.aesgcm
```

### D. Format classification

| Source | Classification |
| --- | --- |
| Authorized resolver | HLS or direct MP4 only; HLS may contain AES-128 and its key URI is proxied opaquely |
| MegaFlix gateway v2 | HLS or direct MP4 only |
| Media preparation | HLS MPEG-TS VOD; no `EXT-X-KEY` in the generated manifest |
| Protected sequential route | HLS control manifest with out-of-band AES-256-GCM per segment; not HLS AES-128/DRM |
| Public embeds | Opaque provider-managed iframe; no raw format assertion |
| DASH / Widevine / PlayReady / ClearKey | Not accepted by first-party resolver schemas and not implemented by the protected player |
| Blob URL | Not returned by any server route; hls.js may use browser-internal MediaSource objects only |

## Phase 2 — tokens and authentication

| Token | Generation and TTL | Binding | Client generation |
| --- | --- | --- | --- |
| Resolver signature | Server HMAC over direction, 13-digit timestamp, 24-char nonce and exact body | Request/response body and nonce | None |
| Authorized-media token | Server random 24-char token, Redis TTL 30–600 s; session payload encrypted with AES-256-GCM | Token + current exact media-origin allowlist | None |
| Playback session | Server random token, configured TTL 60–1800 s | Authenticated user or HttpOnly visitor session owner | None |
| Protected session | Versioned HMAC-SHA256 token, fixed 30 min, random 128-bit nonce | `userId`, `videoId`, issue/expiry time; not IP or User-Agent | None |
| Segment key | `HKDF-SHA256(masterSecret, salt=sessionToken, info="segment-key")` | Exact protected token | Browser receives only an ECDH-wrapped per-session key |

For an authorized HLS `#EXT-X-KEY`, the server rewrites the URI to `/api/v1/playback/media/authorized/{token}/r/{sealed}`. Authentication is the opaque path token and sealed resource; no upstream URL or resolver secret is exposed. Fetch the supported local key URI exactly as emitted by the local manifest:

```bash
curl --fail 'https://[ZIPO_DOMAIN]/api/v1/playback/media/authorized/[MEDIA_TOKEN]/r/[SEALED_KEY_RESOURCE]' \
  --output hls.key
```

No provider client-side token generator is part of the supported integration. The legacy Stream Bridge and MegaFrix extractor remain opt-in and disabled in production defaults; their provider-private media/token logic is not a public ZiPo API contract.

For auditability, the legacy resolver functions present in the source are `resolveMegaFrixSources`, `extractVoltzMp4`, `extractRola3Hls`, `_extract_from_page`, `_pick_stream_url`, `_decode_embedded_urls`, `_extract_rola3`, and `_extract_voltz`. They parse remote provider responses at runtime; no copied client bundle or stable public token-generation function exists in this repository, so no client-side token reimplementation is asserted.

## Phase 3 — MP4 pipeline

Implementation: `apps/api/src/media/pipeline.ts`. `StreamPipeline` validates URL/header syntax, passes CRLF-terminated input headers through ffmpeg `-headers`, uses `-c copy -movflags +faststart`, emits parsed `-progress` events, retries three attempts, applies a 30-second inactivity watchdog, writes an exclusive temporary MP4, atomically renames on success, and removes temporary files on all failures.

Command shape:

```text
ffmpeg -nostdin -hide_banner -loglevel error -headers "Referer: [REFERER_DOMAIN]\r\nAuthorization: Bearer [STREAM_TOKEN]\r\n" -i "[STREAM_URL]" -map 0:v:0? -map 0:a:0? -c copy -movflags +faststart -progress pipe:1 -nostats -n "[OUTPUT].tmp.mp4"
```

Trade-off: the 30-second timeout is reset by ffmpeg output/progress, so long films are supported while stalled inputs still terminate.

## Phase 4 — protected player

Backend: `apps/api/src/routes/protected-stream.ts`, `apps/api/src/stream-protection/*`. Frontend: `apps/web/lib/protected-stream-player.ts`.

The fragment loader serializes all segment fetches, the Redis Lua claim prevents parallel/replayed indexes across replicas, and the player applies `nodownload`, no remote playback/PiP, scoped context-menu/keyboard controls, and a rotating 10%-opacity user watermark refreshed every 30 seconds. DevTools detection and global API monkeypatches are deliberately absent because client code can reverse them and timing detection produces false positives; server authorization remains authoritative.

Protected source layout:

```text
[PROTECTED_STREAM_ROOT]/[VIDEO_ID]/
  stream.json
  segment-000000.ts
  segment-000001.ts
  ...
```

`stream.json`:

```json
{ "segmentDurationSeconds": 10, "lastSegmentDurationSeconds": 8.5 }
```

## Phase 5 — transmission cryptography

Server segment encryption is AES-256-GCM with a fresh 96-bit IV and AAD binding token, video ID, and index. The 16-byte tag is appended to ciphertext and the IV is returned as `X-Segment-IV`. The browser unwraps the HKDF-derived session key through ephemeral P-256 ECDH, keeps the non-extractable `CryptoKey` only in memory, and calls WebCrypto before hls.js receives bytes.

Trade-off: any authorized browser must eventually hold playable plaintext in process memory; this design protects transport captures that lack the ephemeral browser private key, but it cannot make a client-controlled device cryptographically incapable of recording rendered output.
