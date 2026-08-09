# Dual Site Main + NSFW Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do **not** auto-commit unless the user asks.
>
> **Status:** v1 implementada (2026-07-21).

**Goal:** Um único `apps/web` em dois modos (`main` / `nsfw`): principal sem adulto; NSFW com login + gate +18 e catálogo só adulto (filme/série/anime).

**Architecture:** `NEXT_PUBLIC_SITE_MODE` no web; header `X-Zipo-Site` na API; policy `applySiteContentPolicy`; campo `users.adult_confirmed_at`; catálogos NSFW via TMDB adult + Jikan hentai/ecchi.

**Tech Stack:** Next.js 15, Elysia/Bun API, Drizzle/Postgres, Better Auth, `@zipo/shared`, TMDB, Jikan.

**Spec:** `docs/superpowers/specs/2026-07-21-dual-site-nsfw-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/site-mode.ts` | `SiteMode`, parse header/origin, content policy |
| `packages/shared/src/constants.ts` | Expand adult genres/markers (ecchi already there) |
| `packages/shared/src/index.ts` | Export site-mode |
| `apps/api/src/db/schema.ts` | `adultConfirmedAt` |
| `apps/api/drizzle/*.sql` | Migration |
| `apps/api/src/services/site-mode.ts` | Resolve mode from request |
| `apps/api/src/services/adult-filter.ts` | Policy helpers + filter modes |
| `apps/api/src/services/content.ts` | Catalog/search/detail respect site mode + NSFW sources |
| `apps/api/src/services/jikan.ts` | Hentai/ecchi catalog helpers |
| `apps/api/src/services/tmdb.ts` | Adult discover helpers |
| `apps/api/src/routes/account.ts` (new or extend) | `confirm-adult`, me fields |
| `apps/api/src/env.ts` | `NSFW_FRONTEND_URL` |
| `apps/web/middleware.ts` | NSFW auth + age-gate redirects |
| `apps/web/lib/site-mode.ts` | Client/server site mode helpers |
| `apps/web/lib/api.ts` | Send `X-Zipo-Site` |
| `apps/web/app/[locale]/age-gate/*` | Age confirmation UI |
| `apps/web/package.json` | `dev:nsfw` port 3002 |
| `.env` / `.env.example` / `docs/DEV.md` | Env + scripts |

---

### Task 1: Shared site mode + policy

**Files:**
- Create: `packages/shared/src/site-mode.ts`
- Modify: `packages/shared/src/index.ts`, `packages/shared/src/constants.ts`
- Test: `apps/api/tests/unit/site-mode.test.ts`

- [ ] Export `SiteMode`, `parseSiteMode`, `applySiteContentPolicy`
- [ ] Expand adult markers if needed (pornography, sexual)
- [ ] Unit tests for main strips adult / nsfw keeps only adult

### Task 2: DB adultConfirmedAt

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create migration via drizzle

- [ ] Add `adultConfirmedAt` nullable timestamp on `users`
- [ ] Generate/run migration

### Task 3: API site mode + account confirm

**Files:**
- Create: `apps/api/src/services/site-mode.ts`
- Modify: `apps/api/src/env.ts`, routes catalog/search/home/content/featured
- Account confirm endpoint

- [ ] Resolve mode from `X-Zipo-Site` / NSFW origin
- [ ] `POST /api/v1/account/confirm-adult`
- [ ] Expose `adultConfirmed` on session/me
- [ ] Apply policy on list/detail; NSFW requires auth+confirmed

### Task 4: NSFW catalog sources

**Files:**
- Modify: `apps/api/src/services/content.ts`, `jikan.ts`, `tmdb.ts`

- [ ] Movie/series: TMDB discover `include_adult=true`, filter isAdult
- [ ] Anime: Jikan hentai/ecchi / sfw=false pages
- [ ] Main path never returns adult

### Task 5: Web dual mode

**Files:**
- Create: `apps/web/lib/site-mode.ts`, age-gate page
- Modify: `middleware.ts`, `lib/api.ts`, `package.json`, messages pt.json
- Env files

- [ ] `NEXT_PUBLIC_SITE_MODE`, header on fetches
- [ ] Middleware: nsfw → login → age-gate
- [ ] `dev:nsfw` on port 3002
- [ ] CORS + NSFW_FRONTEND_URL

### Task 6: Docs + verification

- [ ] Update `docs/DEV.md`
- [ ] Run unit tests
- [ ] Manual smoke checklist from spec §12

---

## Verification

```bash
pnpm --filter @zipo/api test   # adult + site-mode tests
pnpm dev:web                   # main :3000 — sem adulto
pnpm dev:web:nsfw              # nsfw :3002 — login + gate + só adulto
```
