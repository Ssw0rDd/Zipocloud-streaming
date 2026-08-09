# Setup guide

Clone ZiPo, configure a local stack, and open the main site. For the full variable list see [CONFIGURATION.md](./CONFIGURATION.md). For third-party keys see [THIRD_PARTY_APIS.md](./THIRD_PARTY_APIS.md). Day-to-day tips: [DEV.md](./DEV.md).

## 1. Prerequisites

| Tool | Version / notes |
|---|---|
| Node.js | 20+ |
| pnpm | 10.x (`packageManager` in root `package.json`) |
| Bun | 1.3+ (API) |
| Docker Compose | Postgres, Redis, MinIO |
| FFmpeg / ffprobe | Only if you enable clips, preparation, or Stream Bridge |
| cloudflared (optional) | Public HTTPS tunnel for cookie tests — install from [Cloudflare](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/), do not commit binaries |

## 2. Install dependencies

```bash
git clone <your-fork-or-repo-url> Zipo
cd Zipo
pnpm install --frozen-lockfile
```

## 3. Environment file

```bash
cp .env.example .env
```

Edit `.env` at the **repository root** (both API and web load it):

1. Leave localhost URLs as-is for first run.
2. Generate independent secrets (32+ random characters) for any value starting with `change-me-` if you care about security beyond throwaway local data:
   - `BETTER_AUTH_SECRET`
   - `PLAYBACK_SESSION_SECRET`
   - `CINEMA_ACCESS_SECRET`
   - MinIO / Redis production passwords when not using compose defaults
3. **Recommended:** set `TMDB_ACCESS_TOKEN` (TMDB **v4 read access token**) so catalog and detail pages populate. See [THIRD_PARTY_APIS.md](./THIRD_PARTY_APIS.md).
4. Keep third-party playback providers **disabled** until you intend to use sources you operate or license.

Web-only overrides (usually unnecessary):

```bash
# Optional; pnpm dev:web already loads the root .env
cp apps/web/.env.local.example apps/web/.env.local
```

Never commit `.env` or `.env.local`.

## 4. Data services

```bash
docker compose up -d postgres redis minio minio-init
docker compose ps
```

- Postgres is published on host port **5434** by default (`DATABASE_URL` already matches).
- Redis: `redis://127.0.0.1:6379`
- MinIO API: `http://localhost:9000` (credentials from `.env`)

## 5. Database migrations

```bash
pnpm db:migrate
```

Re-run after pulls that change the schema.

## 6. Run API + web

```bash
pnpm dev:all
```

Or separately:

```bash
pnpm dev          # API :3001
pnpm dev:web      # web :3000
```

Checks:

```bash
curl -s http://localhost:3001/health/live
# open http://localhost:3000
```

Swagger UI is available at `http://localhost:3001/docs` outside production.

### Dual site (NSFW, optional)

```bash
pnpm dev:web:nsfw   # :3002, NEXT_PUBLIC_SITE_MODE=nsfw
```

Set `NSFW_FRONTEND_URL` and use age gate flows described in [DEV.md](./DEV.md). Adult movie/series catalog benefits strongly from `TMDB_ACCESS_TOKEN`.

## 7. Optional features

| Goal | Minimal flags |
|---|---|
| Richer catalog | `TMDB_ACCESS_TOKEN` (+ optional Trakt/OMDb/AniList) |
| Cinema | `CINEMA_ENABLED=true`, `NEXT_PUBLIC_CINEMA_ENABLED=true`, Redis up |
| Clips | media worker + MinIO + `CLIPS_ENABLED` (see DEV.md) |
| Stream Bridge | Python service + `STREAM_BRIDGE_*` (see `services/zipo-stream-bridge`) |
| Pix supporter | Mercado Pago keys + amount (see [SUPPORTER_PIX.md](./SUPPORTER_PIX.md)) |
| Public tunnel | install cloudflared, set `TUNNEL_URL`, restart **API only** ([tools/cloudflared](../tools/cloudflared/README.md)) |

## 8. Quality gates (before contributing)

```bash
pnpm lint
pnpm typecheck
pnpm test:security
pnpm test:sdk
pnpm build
```

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full PR checklist.

## 9. Production

Do not use local secrets. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) and `docker-compose.prod.yml` with real TLS under `TLS_CERT_DIR`.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Empty home / missing posters | `TMDB_ACCESS_TOKEN`, Docker network, API logs |
| Auth redirects to wrong host | `FRONTEND_URL` / `BETTER_AUTH_URL` must be the **web** origin, not `:3001`, no `/api` suffix |
| Port 5432 conflict | Use `localhost:5434` as in `.env.example` |
| Redis down | API may still boot; cache/rate-limit degrade — start `redis` via compose |
| Tunnel auth broken | `TUNNEL_URL` origin only; restart API after changing it |

Still stuck? Open a discussion/issue with redacted logs (no tokens, no private media URLs).
