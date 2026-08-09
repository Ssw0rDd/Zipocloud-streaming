# Third-party APIs

Where to create credentials and read official docs for integrations that **ZiPo documents publicly**.

> **Compliance:** Use only data and media you are allowed to process. Streaming providers you enable remain your responsibility under their terms of service and copyright law. ZiPo does not ship provider credentials and disables optional playback embeds by default in [`.env.example`](../.env.example).

A **private operator-owned playback provider** may exist in a given deployment or fork. **Signup and configuration URLs for that private stack are intentionally not listed here.** Leave the corresponding `*_ENABLED` flags false unless you control those systems.

Related: [CONFIGURATION.md](./CONFIGURATION.md), [SETUP.md](./SETUP.md), [SUPPORTER_PIX.md](./SUPPORTER_PIX.md).

---

## Catalog & metadata (keys)

### TMDB (strongly recommended)

| | |
|---|---|
| **Purpose** | Movies, series, posters, adult catalog signals |
| **Env** | `TMDB_ACCESS_TOKEN` — **v4 Read Access Token** (Bearer), not the legacy v3 key string alone |
| **Sign up / keys** | https://www.themoviedb.org/settings/api |
| **Official docs** | https://developer.themoviedb.org/docs |
| **API origin (reference)** | `https://api.themoviedb.org/3` |

Create a TMDB account → request API access → copy the **API Read Access Token** into `.env`.

### Trakt (optional)

| | |
|---|---|
| **Purpose** | Optional catalog enrichment |
| **Env** | `TRAKT_CLIENT_ID` |
| **Applications** | https://trakt.tv/oauth/applications |
| **API docs** | https://trakt.docs.apiary.io/ |

### OMDb (optional)

| | |
|---|---|
| **Purpose** | Optional IMDb-oriented metadata enrichment |
| **Env** | `OMDB_API_KEY` |
| **API key** | https://www.omdbapi.com/apikey.aspx |
| **Site** | https://www.omdbapi.com/ |

### AniList (optional OAuth)

| | |
|---|---|
| **Purpose** | Anime metadata (public GraphQL without key); OAuth for user-linked features |
| **Env** | `ANILIST_CLIENT_ID`, `ANILIST_CLIENT_SECRET`, `OAUTH_TOKEN_ENCRYPTION_KEY` |
| **Developer apps** | https://anilist.co/settings/developer |
| **Docs** | https://anilist.gitbook.io/anilist-docs |
| **GraphQL** | https://graphql.anilist.co |

Generate a local `OAUTH_TOKEN_ENCRYPTION_KEY` (≥ 32 random characters) whenever AniList OAuth is enabled. Never reuse production secrets from other services.

---

## Catalog & metadata (no key)

These clients use public HTTP APIs. Rate limits and ToS still apply—treat them as best-effort.

| Service | Purpose | Docs / entry |
|---|---|---|
| **Jikan** (unofficial MAL API) | Anime metadata | https://docs.api.jikan.moe/ · https://api.jikan.moe |
| **Kitsu** | Anime/manga metadata | https://kitsu.docs.apiary.io/ · https://kitsu.io/api/edge |
| **TVmaze** | TV schedules / metadata | https://www.tvmaze.com/api · https://api.tvmaze.com |
| **Cinemeta** (Stremio addon-style metadata) | Title metadata | `https://v3-cinemeta.strem.io` (community; no official key) |
| **Shikimori** | JP catalog | https://shikimori.one/api/doc · https://shikimori.one/api |
| **Wikidata** | Search assist | https://www.wikidata.org/wiki/Wikidata:Data_access |

Image hosts used by default (allowlist via `NEXT_IMAGE_HOSTS`) include TMDB, Metahub, MyAnimeList CDN, Kitsu, TVmaze, AniList CDN, Shikimori, and Amazon media — do not blindly expand the list to untrusted CDNs.

---

## Payments

### Mercado Pago (Pix lifetime supporter)

| | |
|---|---|
| **Env** | `MERCADO_PAGO_ENABLED`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `SUPPORTER_PIX_*` |
| **Developers** | https://www.mercadopago.com.br/developers |
| **API docs** | https://www.mercadopago.com.br/developers/en/docs |
| **ZiPo guide** | [SUPPORTER_PIX.md](./SUPPORTER_PIX.md) |

Use test credentials in sandbox before production webhooks.

---

## Optional playback base URLs

Optional embed or aggregator base URLs (`SUPERFLIX_*`, `WAREZCDN_*`, `VIDEASY_*`, `VIDKING_*`, `VIDLINK_*`, `VIDSRC_*`, `TWOEMBED_*`, and authorized-media resolvers) are **operator-supplied**.

| Guidance | |
|---|---|
| Defaults | All **disabled** in public `.env.example` |
| When to enable | Only for sources you run, license, or that permit your use case |
| Config pattern | `*_ENABLED=true` + HTTPS `*_BASE_URL` / resolver secret + origin allowlists |
| CSP | Changing base URLs requires a web rebuild so content security policy stays aligned |
| Internal routes | Browser-facing media never receives raw resolver secrets |

Preferred long-term path for owned content: **authorized-media** resolver + exact CDN HTTPS origins ([AUTHORIZED_MEDIA_RESOLVER.md](./AUTHORIZED_MEDIA_RESOLVER.md)).

Contracts: [STREAM_ENDPOINTS.md](./STREAM_ENDPOINTS.md). Local flags: [FEATURE_FLAGS.md](./FEATURE_FLAGS.md).

---

## Infrastructure third parties (not media APIs)

| Component | Notes |
|---|---|
| PostgreSQL / Redis / MinIO | Provided via Docker Compose; no SaaS key required for local dev |
| Cloudflare Tunnel | Optional; install CLI: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/ |

---

## Checklist for a healthy open clone

1. `TMDB_ACCESS_TOKEN` set  
2. All random secrets rotated from `change-me-*` if exposing the host beyond laptop-only  
3. Playback `*_ENABLED` flags remain `false` until you accept the legal/ops burden  
4. No real tokens committed (`.env` is gitignored)  
