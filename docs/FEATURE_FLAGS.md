# ZiPo — Feature flags e rollout

Flags usadas no cutover de conclusão. Defaults seguros para produto privado
sem receita e sem bypass de embeds.

## API (`apps/api`)

| Flag | Default | Efeito |
|------|---------|--------|
| `AUTHORIZED_MEDIA_ENABLED` | `false` | HLS/MP4 via resolver HMAC próprio/licenciado |
| `SECURE_EMBED_FALLBACK_ENABLED` | `true` | Embeds HTTPS sandboxed (Videasy/VidLink/VidKing) |
| `MEGAFRIX_ENABLED` | `false` | Mantido off; **não** extrai streams de embed |
| `SUPERFLIX_ENABLED` / `WAREZCDN_ENABLED` | `false` | Providers unsandboxed opcionais |
| `OWN_PREROLL_ENABLED` | `false` | Preroll first-party no player |
| `ADS_ENABLED` | `false` | Anúncios first-party (banner/overlay/preroll config) |
| `CLIPS_ENABLED` | `false` | Expõe criação/retry de clips na API; requer worker ativo |
| `MEDIA_WORKER_ENABLED` | `false` | Só no serviço `media-worker` (API fica `false`) |
| `MEDIA_PREPARATION_ENABLED` | `false` | Fila de preparação HLS VOD |
| `FFMPEG_HWACCEL` | `auto` | `auto`/`nvenc`/`amf`/`none` no worker |
| `CLIP_QUEUE_MAX_DEPTH` | `200` | Backpressure clips → 429 |
| `PREPARATION_QUEUE_MAX_DEPTH` | `100` | Backpressure preparation → 429 |
| `EMBED_CINEMA_CHAT_ONLY` | `true` | Cinema: chat/presença; sem sync/print/clip |
| `IMAGE_PIPELINE_V2` | `false` | Gateway same-origin `/api/v1/images/:assetId` |
| `HOME_CACHE_V3` | `false` | `GET /api/v3/home` com Redis SWR |
| `DARK_UI_V2` | `false` | Reservado (tokens dark já aplicados no web) |
| `PWA_ENABLED` | `false` | Espelho server-side; registro SW é no web |
| `CINEMA_ENABLED` | `false` | Salas Cinema |
| `PLAYBACK_V2_ENABLED` | `true` | Sessões / embeds v2 |

## Stream Bridge

| Variável | Default | Efeito |
|----------|---------|--------|
| `STREAM_BRIDGE_ENABLED` | `false` | Habilita preparação interna de mídia; exige secret próprio |
| `STREAM_BRIDGE_ALLOWED_MEDIA_HOSTS` | vazio | Hosts HTTPS adicionais de CDN; host exato ou sufixo iniciado por `.` |

O bridge valida DNS/IP público e todos os redirecionamentos. Em produção, a
allowlist deve ser combinada com bloqueio de egress para redes privadas,
link-local, loopback e metadata de nuvem.

## Web (`NEXT_PUBLIC_*`)

| Flag | Default | Efeito |
|------|---------|--------|
| `NEXT_PUBLIC_PWA_ENABLED` | `false` | Registra service worker (shell only) |
| `NEXT_PUBLIC_DARK_UI_V2` | `false` | Ajustes visuais condicionais |
| `NEXT_PUBLIC_EMBED_CINEMA_CHAT_ONLY` | `true` | Espelho UI Cinema |
| `NEXT_PUBLIC_ADS_ENABLED` | (ausente) | `AdSlot` só renderiza se `true` |
| `NEXT_PUBLIC_CINEMA_ENABLED` | `false` | Entrada Cinema no produto |
| `NEXT_PUBLIC_ANIME4K_ENABLED` | `false` | Upscaler WebGPU lazy |

## Rollout sugerido

1. Produção base: ads off, MegaFrix/SuperFlix/Warez off, embeds seguros on.
2. Ligar `HOME_CACHE_V3=true` após Redis estável.
3. Ligar `IMAGE_PIPELINE_V2=true` após MinIO + allowlist de hosts ok.
4. Ligar `NEXT_PUBLIC_PWA_ENABLED=true` após validar SW não cacheia `/api/`.
5. Cinema: `CINEMA_ENABLED=true` + `EMBED_CINEMA_CHAT_ONLY=true` até haver mídia controlada.
6. Authorized media: configurar resolver + secret + origins, então `AUTHORIZED_MEDIA_ENABLED=true`.

## Health

- `GET /health/live` — processo
- `GET /health/ready` — Postgres + Redis
- `GET /health` — ok se db+redis; providers só como métricas

## Critério de pronto

- Nenhuma imagem externa bloqueada pela CSP quando pipeline v2 ativo (URLs same-origin)
- Sem high severity conhecido (`drizzle-orm` ≥ 0.45.2)
- Rotas com `loading.tsx` / estados vazios
- Docs alinhadas ao comportamento real (sem promessa de bypass/remoção de ads de terceiros)
