# Configuration reference

Root environment file: copy [`.env.example`](../.env.example) to `.env`. Both `apps/api` and `apps/web` (via `scripts/with-root-env.mjs`) load this file. Optional web-only overrides: [`apps/web/.env.local.example`](../apps/web/.env.local.example).

**Required for a useful first run**

| Variable | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Default matches compose (`localhost:5434`) |
| `REDIS_URL` | Recommended | Cache, rate limit, cinema |
| `BETTER_AUTH_SECRET` | Yes (prod) | ≥ 32 random chars |
| `TMDB_ACCESS_TOKEN` | Strongly recommended | Catalog quality |
| Other secrets | When enabling features | Each feature section below |

Replace every `change-me-*` value before production. Full third-party signup links: [THIRD_PARTY_APIS.md](./THIRD_PARTY_APIS.md). Feature product docs: [FEATURE_FLAGS.md](./FEATURE_FLAGS.md).

---

## Infrastructure

| Variable | Default (example) | Description |
|---|---|---|
| `PORT` | `3001` | API listen port |
| `NODE_ENV` | `development` | `production` in prod compose |
| `API_URL` | `http://localhost:3001` | Absolute API base (SSR rewrites, callbacks) |
| `FRONTEND_URL` | `http://localhost:3000` | Main site origin |
| `NSFW_FRONTEND_URL` | `http://localhost:3002` | Dual-site NSFW origin |
| `DATABASE_URL` | `postgresql://zipo:zipo@localhost:5434/zipo` | Postgres connection string |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis |
| `REDIS_PASSWORD` | placeholder | Production Redis auth (base64url ≥ 32) |
| `TLS_CERT_DIR` | `./secrets/tls` | Prod certs dir (`fullchain.pem`, `privkey.pem`) |

## Auth & HTTP

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Session signing secret (≥ 32 chars in production) |
| `BETTER_AUTH_URL` | Optional; defaults from `FRONTEND_URL` / tunnel |
| `CORS_ORIGINS` | Extra allowed origins (comma-separated) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | Global HTTP rate limit |
| `TRUST_PROXY_HEADERS` | Trust `X-Forwarded-*` (auto true with tunnel) |
| `VIEWS_FLUSH_INTERVAL_MS` | View counter flush interval |

Auth base URL must be the **browser origin** (web), never the raw API port and never a path ending in `/api`.

## Feature flags

| Variable | Default in example | Purpose |
|---|---|---|
| `SEARCH_V2_ENABLED` | `true` | V2 search API |
| `PLAYBACK_V2_ENABLED` | `true` | V2 playback orchestration |
| `NATIVE_PLAYER_ONLY` | `true` | Prefer native player paths |
| `SECURE_EMBED_FALLBACK_ENABLED` | `false` | Allow configured embed providers |
| `OWN_PREROLL_ENABLED` | `false` | First-party preroll |
| `CINEMA_ENABLED` | `false` | Cinema rooms (API) |
| `EMBED_CINEMA_CHAT_ONLY` | `false` | Chat-only cinema without full A/V sync |
| `CLIPS_ENABLED` | `false` | Product flag for clips |
| `MEDIA_WORKER_ENABLED` | `false` | This process runs FFmpeg jobs |
| `MEDIA_PREPARATION_ENABLED` | `false` | Queue preparation jobs |
| `IMAGE_PIPELINE_V2` / `HOME_CACHE_V3` / `DARK_UI_V2` / `PWA_ENABLED` / `ADS_ENABLED` | `false` | Optional product experiments |
| `FFMPEG_HWACCEL` | `auto` | Worker hardware encoder selection |
| `CLIP_*` / `PREPARATION_QUEUE_MAX_DEPTH` | see example | Queue depths and per-user limits |

Frontend mirrors: `NEXT_PUBLIC_CINEMA_ENABLED`, `NEXT_PUBLIC_EMBED_CINEMA_CHAT_ONLY`, `NEXT_PUBLIC_SITE_MODE`, `NEXT_PUBLIC_SITE_NAME`, `NEXT_PUBLIC_*` flags listed in `.env.example`.

## Playback sessions & Cinema

| Variable | Description |
|---|---|
| `PLAYBACK_SESSION_TTL_SECONDS` | Opaque session lifetime |
| `PLAYBACK_SESSION_SECRET` | Independent signing secret |
| `OWN_PREROLL_URL` / skip / frequency | Preroll asset and cadence |
| `CINEMA_ROOM_IDLE_HOURS` | Idle room cleanup |
| `CINEMA_MAX_PARTICIPANTS` | Cap per room |
| `CINEMA_ACCESS_SECRET` | Room access signing |

## Storage & media workers

| Variable | Description |
|---|---|
| `S3_*` | MinIO/S3 endpoint, bucket, credentials, path style |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Binary names or paths |
| `INTERNAL_API_URL` | Worker → API base |
| `MEDIA_CACHE_TTL_SECONDS` | Media cache TTL |
| `MEDIA_SOURCE_ENCRYPTION_KEY` | Encrypt stored source descriptors (required when preparation is on in prod) |
| `STREAM_BRIDGE_*` | Python stream-bridge URL, secrets, job DB, limits, allowlisted media hosts |
| `PROTECTED_STREAM_*` | First-party segment root and master secret |

See [AUTHORIZED_MEDIA_RESOLVER.md](./AUTHORIZED_MEDIA_RESOLVER.md), [STREAM_ENDPOINTS.md](./STREAM_ENDPOINTS.md), and `services/zipo-stream-bridge`.

## Playback providers

Public clone defaults keep **all third-party embeds off**. Enable only what you operate or license.

| Group | Variables | Notes |
|---|---|---|
| SuperFlix / WarezCDN | `SUPERFLIX_*`, `WAREZCDN_*` | Optional; off by default |
| Private operator slot | `MEGAFRIX_*` | Fork/operator-owned; **not documented** for public onboarding — leave `ENABLED=false` unless you own the stack |
| Owned gateway | `MEGAFLIX_GATEWAY_*` | Server-to-server licensed gateway |
| Authorized media | `AUTHORIZED_MEDIA_*` | Your resolver + CDN allowlist |
| Documented embeds | `VIDEASY_*`, `VIDKING_*`, `VIDLINK_*`, `VIDSRC_*`, `TWOEMBED_*` | Off by default; sandbox/CSP implications |

Changing any `*_BASE_URL` used in embeds requires rebuilding the web CSP surface.

## Payments

| Variable | Description |
|---|---|
| `MERCADO_PAGO_ENABLED` | Master switch |
| `MERCADO_PAGO_ACCESS_TOKEN` | Server token |
| `MERCADO_PAGO_WEBHOOK_SECRET` | Webhook verification |
| `SUPPORTER_PIX_AMOUNT_CENTS` | Fixed amount (server-side) |
| `SUPPORTER_PIX_EXPIRATION_MINUTES` | QR lifetime |

Details: [SUPPORTER_PIX.md](./SUPPORTER_PIX.md).

## Catalog keys

| Variable | Description |
|---|---|
| `TMDB_ACCESS_TOKEN` | TMDB **v4** read access token |
| `TRAKT_CLIENT_ID` | Optional enrichment |
| `OMDB_API_KEY` | Optional enrichment |
| `ANILIST_CLIENT_ID` / `ANILIST_CLIENT_SECRET` | OAuth for AniList features |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | Encrypt stored OAuth tokens (≥ 32 chars) |

## Frontend & images

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SITE_MODE` | `main` or `nsfw` (prefer scripts, not dual on one port) |
| `NEXT_PUBLIC_SITE_NAME` | Brand string (default `ZiPo`) |
| `NEXT_PUBLIC_ANIME4K_ENABLED` | Client upscaler flag |
| `NEXT_IMAGE_HOSTS` | Comma-separated hostname allowlist for image optimizer |

## Tunnels

| Variable | Description |
|---|---|
| `TUNNEL_URL` | Public origin for main site (`https://….trycloudflare.com`) |
| `NSFW_TUNNEL_URL` | Separate origin for NSFW site |

When set, the API derives frontend/auth/CORS and trusts proxy headers. Restart the API after changes. Helper notes: [tools/cloudflared/README.md](../tools/cloudflared/README.md).

---

## Related docs

- [SETUP.md](./SETUP.md) — guided first run  
- [DEV.md](./DEV.md) — local recipes  
- [DEPLOYMENT.md](./DEPLOYMENT.md) — production  
- [FEATURE_FLAGS.md](./FEATURE_FLAGS.md) — product flag semantics  
