# ZiPo — Guia de desenvolvimento local

**Primeira configuração:** [SETUP.md](./SETUP.md) · [CONFIGURATION.md](./CONFIGURATION.md) · [THIRD_PARTY_APIS.md](./THIRD_PARTY_APIS.md) · README: [EN](../README.md) · [pt-BR](./i18n/README.pt-BR.md) · [zh-CN](./i18n/README.zh-CN.md)

## Stack local

```bash
pnpm install
docker compose up -d postgres redis
pnpm dev:all
```

- Web (main, limpo): `http://localhost:3000` — `pnpm dev:web`
- Web (NSFW +18): `http://localhost:3002` — `pnpm dev:web:nsfw` (login + confirmação de idade)
- API: `http://localhost:3001`
- Saúde: `http://localhost:3001/health` (`/health/live`, `/health/ready`)

Sites dual: o mesmo `apps/web` sobe em dois modos (`NEXT_PUBLIC_SITE_MODE=main|nsfw`).
A API usa o header `X-Zipo-Site` / `NSFW_FRONTEND_URL` para filtrar catálogo.
Veja `docs/superpowers/specs/2026-07-21-dual-site-nsfw-design.md`.

- `pnpm db:migrate` após pull (ex.: coluna `users.is_supporter`)
- NSFW movie/series precisa de `TMDB_ACCESS_TOKEN` (Cinemeta quase não tem adult)
- Auth: `BETTER_AUTH_URL` = origem do frontend (`http://localhost:3000`), nunca `:3001` nem sufixo `/api`
- Cinema (watch party): `CINEMA_ENABLED=true` + `NEXT_PUBLIC_CINEMA_ENABLED=true`. Só cria sala se o **Player 1 for HLS nativo (m3u8)** elegível — mesma regra dos clips. Com `EMBED_CINEMA_CHAT_ONLY=false`: player sincronizado, print no chat e clips clicáveis; com `true`: só chat/presença.
- Redis precisa estar up para salas Cinema (`pnpm dev:deps`)

## Cinema sync + Stream Bridge (Windows)

Serviço Python em `services/zipo-stream-bridge/` — extrai `.m3u8` de SuperFlix/WarezCDN,
transcodifica com FFmpeg (NVENC se disponível) e publica HLS no MinIO para o player
nativo + sync WebSocket do Cinema. Use somente com mídia autorizada; jobs ficam
em SQLite e são reconciliados após restart.

```powershell
pnpm dev:deps
pnpm stream-bridge:dev
# outro terminal
pnpm dev:all
```

Variáveis mínimas (`.env` raiz):

```env
STREAM_BRIDGE_ENABLED=true
STREAM_BRIDGE_URL=http://localhost:8090
STREAM_BRIDGE_SECRET=<32+ chars>
SUPERFLIX_ENABLED=true
CINEMA_ENABLED=true
EMBED_CINEMA_CHAT_ONLY=false
MEDIA_PREPARATION_ENABLED=true
CLIPS_ENABLED=true
MEDIA_WORKER_ENABLED=true
NEXT_PUBLIC_CINEMA_ENABLED=true
NEXT_PUBLIC_EMBED_CINEMA_CHAT_ONLY=false
```

Teste manual sync (2 browsers):

1. Host cria sala Cinema em `/watch/...` (logado).
2. Convidado abre o link da sala — overlay “Preparando stream HLS nativo…” some quando o bridge termina.
3. Host: Play juntos / Pausar / seek — convidado deve seguir com drift &lt; 2s (modo `native`).

Docker (opcional): `docker compose --profile stream-bridge up -d stream-bridge`

Detalhes: [`services/zipo-stream-bridge/README.md`](../services/zipo-stream-bridge/README.md)

## Playback providers

Native playback uses **authorized-media** (owned/licensed HLS/MP4 via the private
resolver in [`AUTHORIZED_MEDIA_RESOLVER.md`](./AUTHORIZED_MEDIA_RESOLVER.md)).
Keep it disabled until the resolver URL, 32+ character secret and exact CDN origin
allowlist are configured.

When native sources are unavailable, the player may fall back to embeds when
`SECURE_EMBED_FALLBACK_ENABLED=true` and individual providers are enabled (all off
in public [`.env.example`](../.env.example)):

- Sandboxed: Videasy / VidLink / VidKing / VidSrc
- Unsandboxed (origin-checked): SuperFlix / WarezCDN / 2Embed

```env
# Optional embeds — enable only sources you operate or license
SUPERFLIX_ENABLED=false
WAREZCDN_ENABLED=false
MEGAFRIX_ENABLED=false
AUTHORIZED_MEDIA_ENABLED=false
VIDEASY_ENABLED=false
VIDKING_ENABLED=false
VIDLINK_ENABLED=false
VIDSRC_ENABLED=false
TWOEMBED_ENABLED=false
SECURE_EMBED_FALLBACK_ENABLED=false
TMDB_ACCESS_TOKEN=
```

Private operator-owned providers stay undocumented publicly; keep them disabled
unless you control those systems. Each provider has an independent feature flag.

Secure embed origins enter the CSP during the frontend build. Changing any
`*_BASE_URL` requires a new build.

## Health checks

- `GET /health/live` — process liveness (`{ status: "ok" }`)
- `GET /health/ready` — Postgres + Redis only (503 if either is down)
- `GET /health` — ok when db+redis are up; provider statuses are listed as metrics

## Tunnel local

Use o tunnel só quando precisar de HTTPS público (cookies, CORS, mobile externo):

```bash
# Windows: use 127.0.0.1 (localhost costuma ir para [::1])
# 1) suba o web: pnpm dev:web
# 2) tunnel
cloudflared tunnel --url http://127.0.0.1:3000
```

**Só uma variável no `.env`:** cole a origem do quick tunnel em `TUNNEL_URL` e **reinicie a API**.

```env
# Ex.: https://xxxx.trycloudflare.com  (sem path /api)
TUNNEL_URL=https://xxxx.trycloudflare.com
```

Com `TUNNEL_URL` preenchido a API deriva automaticamente:

- `FRONTEND_URL` (redirects, share de clips)
- `BETTER_AUTH_URL` (cookies/auth no browser)
- `CORS_ORIGINS` (merge com localhost)
- `TRUST_PROXY_HEADERS=true`

Local sem tunnel: deixe `TUNNEL_URL=` vazio e use `FRONTEND_URL=http://localhost:3000`.

NSFW em tunnel separado:

```env
NSFW_TUNNEL_URL=https://yyyy.trycloudflare.com
```

`BETTER_AUTH_URL` com sufixo `/api` ou apontando para a API (`:3001`) quebra o sign-up/sign-in.

Se o root `/` do tunnel mandar o browser para `localhost`, confira se o web reiniciou com o middleware atual (redirects de locale são relativos). Prefira abrir `https://xxxx.trycloudflare.com/pt`.

## Redis e metadados

O Redis guarda metadados, fontes temporárias, snapshots TMDB/IMDb separados por provider e a união usada pelo catálogo geral. Falha de sincronização preserva o último snapshot válido de cada provider. Snapshot ausente ou vencido resulta em `playbackAvailability: "unknown"` e não bloqueia a tentativa de reprodução.

## Override manual MAL/IMDb → TMDB

```bash
pnpm --filter @zipo/api mapping:override -- anime 5114 31911
```

Formato: `<movie|series|anime> <content-id> <tmdb-id>`.

Animes usam MAL/Jikan no catalogo, mas SuperFlix e WarezCDN usam TMDB no embed.
O mapeamento remove sufixos de temporada e localiza o episodio real por titulo
ou data. Assim, por exemplo, o episodio 1 de uma sequencia MAL pode apontar para
um episodio posterior na temporada unica cadastrada no TMDB.

## Feature flags

See [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) for rollout (`IMAGE_PIPELINE_V2`,
`HOME_CACHE_V3`, `PWA_ENABLED`, `EMBED_CINEMA_CHAT_ONLY`, etc.).

## Escala (produção)

Stack completa:

```bash
docker compose -f docker-compose.prod.yml up -d --build
# Workers FFmpeg (opcional):
docker compose -f docker-compose.prod.yml --profile media-worker up -d --scale media-worker=2
# API multi-réplica (leader election via Redis):
docker compose -f docker-compose.prod.yml up -d --scale api=2
```

- Redis: `512mb` AOF + LRU; sessões de playback e filas compartilham a mesma instância.
- Nginx: `least_conn` + keepalive para `api`/`web`; `worker_connections 4096`.
- Jobs (views flush, catalog sync, media cleanup, episode notifications): só o líder Redis executa.
- FFmpeg: workers usam `FFMPEG_HWACCEL=auto|nvenc|amf|none` (fallback `libx264`).
- Filas: `CLIP_QUEUE_MAX_DEPTH` / `PREPARATION_QUEUE_MAX_DEPTH` → HTTP 429 + `Retry-After`.
- CDN: configure `AUTHORIZED_MEDIA_ORIGINS` com origins HTTPS exatas. As rotas
  opacas atuais passam pelo gateway de mídia da API; dimensione banda/conexões ou
  separe esse gateway antes de carga alta.

### Checklist de aceitação (≥1000 viewers)

- [ ] Criação de sessão (`POST /api/v2/playback/sessions`) estável sob carga
- [ ] Latência de start HLS e capacidade do gateway de mídia aceitáveis
- [ ] Redis memória e `jobs:leader:v1` estáveis com N réplicas de API
- [ ] Lag das filas `media:clip` / `media:preparation` sob controle com N workers
- [ ] Conexões Nginx sem saturar `worker_connections`

## Validação

```bash
pnpm typecheck
pnpm lint
pnpm --filter @zipo/web validate-i18n
pnpm test:security
pnpm --filter @zipo/api test
pnpm test:sdk
pnpm pentest:static
pnpm check:supply-chain
pnpm --filter @zipo/web test:e2e:install
pnpm --filter @zipo/web test:e2e
pnpm build
pnpm check:artifacts
```
