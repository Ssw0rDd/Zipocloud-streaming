# ZiPo Dual Site (Main + NSFW) — Design Spec

**Data:** 2026-07-21  
**Status:** Aprovado — implementação em andamento / entregue (v1)  
**Idioma do produto:** pt-BR  

## 1. Resumo

Separar a plataforma em dois frontends do **mesmo código** (`apps/web`):

| Site | Modo | Porta dev (proposta) | Conteúdo |
|------|------|----------------------|----------|
| ZiPo principal | `main` | `:3000` | Sem NSFW (sem hentai, ecchi, pornô, XXX, Rx, TMDB adult, etc.) |
| ZiPo NSFW | `nsfw` | `:3002` | Só adulto: filmes pornográficos, séries adultas, anime hentai/ecchi |

- Mesma API (`apps/api`)
- Mesma conta / sessão (Better Auth)
- Site NSFW: login obrigatório + confirmação de idade (+18) na primeira visita (persistida na conta)

## 2. Decisões aprovadas

1. **Hospedagem:** opção A — um app web, `SITE_MODE=main|nsfw`, outro domínio/porta  
2. **Conta:** mesma conta/sessão nos dois sites  
3. **Catálogo NSFW:** explícito + ecchi; no principal some tudo isso  
4. **Gate de idade:** tela “Tenho 18+” na primeira visita, salva no perfil  

## 3. Objetivos

### Site `main`
- Zero conteúdo adulto em home, catálogo, busca, recomendações, detalhe, player, cinema, clips  
- Detecção reforçada (gêneros, ratings, flags upstream)  
- API ignora/força `includeAdult=false` neste modo  

### Site `nsfw`
- Paridade de features com o principal (home, explorar, busca, detalhe, watch, cinema, playlists, etc.)  
- Catálogo **somente** `isAdult === true`  
- Rotas de conteúdo exigem sessão autenticada  
- Sem `adultConfirmedAt` → só login/registro + tela de confirmação +18  

## 4. Arquitetura

```
┌─────────────────┐     ┌─────────────────┐
│  Web main:3000  │     │  Web nsfw:3002  │
│ SITE_MODE=main  │     │ SITE_MODE=nsfw  │
└────────┬────────┘     └────────┬────────┘
         │  cookie sessão        │
         │  Header X-Zipo-Site   │
         └──────────┬────────────┘
                    ▼
              ┌──────────┐
              │ API :3001│
              └──────────┘
```

### 4.1 Identificação do modo (API)

Ordem de resolução:

1. Header `X-Zipo-Site: main | nsfw` (enviado pelo web)  
2. Fallback: `Origin` / `Referer` ∈ `NSFW_FRONTEND_URL` → `nsfw`  
3. Default: `main`  

Query `includeAdult` **não** controla mais o modo do site:
- `main` → sempre exclui adulto  
- `nsfw` → sempre exige adulto (e auth + age gate)

### 4.2 Identificação do modo (Web)

- `NEXT_PUBLIC_SITE_MODE=main|nsfw`  
- Scripts:
  - `pnpm dev:web` → main `:3000`  
  - `pnpm dev:web:nsfw` → nsfw `:3002` com env NSFW  
- Branding leve: nome/título “ZiPo NSFW” no modo nsfw (mesma UI base)

## 5. Autenticação e gate +18

### 5.1 Conta compartilhada
- Better Auth já existente; `CORS_ORIGINS` inclui main + nsfw  
- Cookies: em localhost portas diferentes **não** compartilham cookie automaticamente  
  - **Solução:** web NSFW usa o mesmo fluxo de login via API; sessão por cookie no domínio da API (`API_URL`) com credentials, ou login embutido no NSFW que grava sessão no host da API  
  - Alternativa aceitável em dev: re-login no NSFW (mesma conta); em produção com subdomínios (`zipo.app` / `nsfw.zipo.app`) cookie em `.zipo.app`

### 5.2 Campo de perfil
Migração Drizzle na tabela `users`:

```ts
adultConfirmedAt: timestamp("adult_confirmed_at", { withTimezone: true })
```

- `null` → ainda não confirmou  
- preenchido → gate ok (permanente até limpeza admin)

### 5.3 Endpoints
- `POST /api/v1/account/confirm-adult` — autenticado; seta `adultConfirmedAt = now()`  
- `GET /api/v1/account/me` (ou campo na sessão) — expõe `adultConfirmed: boolean`

### 5.4 Middleware web NSFW
- Não autenticado → redirect `/auth/login` (exceto auth)  
- Autenticado sem confirmação → `/age-gate`  
- Após confirmar → acesso total ao site NSFW  

## 6. Detecção de conteúdo adulto

Centralizar em `@zipo/shared` + `detectAdultContent`.

### 6.1 Sinais (inclusão NSFW / exclusão main)

| Fonte | Sinais |
|-------|--------|
| Gêneros/tags | hentai, ecchi, erotica, adult, xxx, porn, nsfw, pornography |
| Jikan | `explicit_genres`, `rating` contendo Rx / Hentai / R18 |
| TMDB | `adult: true`; keywords pornográficas quando disponível |
| Título | hentai, xxx, nsfw, porn |
| Certificação | NC-17, X, R18+, 18+, Rx |

### 6.2 Comportamento por modo

```ts
type SiteMode = "main" | "nsfw";

function applySiteContentPolicy(items, mode) {
  if (mode === "main") return items.filter(i => !i.isAdult);
  return items.filter(i => i.isAdult);
}
```

Detalhe / playback / cinema / clips no `main`: se `isAdult` → `404` ou `403 CONTENT_BLOCKED_MAIN`.  
No `nsfw`: se `!isAdult` → `404` (não misturar catálogo limpo).

## 7. Fontes de catálogo NSFW

### 7.1 Filmes (`movie`)
- TMDB `discover/movie?include_adult=true&sort_by=popularity.desc`  
- Manter só itens com `adult === true` **ou** detectAdultContent  
- Resolver IMDb via `external_ids` (igual catálogo atual)

### 7.2 Séries (`series`)
- TMDB `discover/tv` com filtros adultos quando possível + keywords  
- Fallback: Cinemeta genre/`search` filtrado por detectAdultContent  
- Meta: só itens `isAdult`

### 7.3 Anime (`anime`)
- Jikan: endpoints com gênero Hentai / Ecchi / `sfw=false` onde aplicável  
- Incluir `explicit_genres` na detecção  
- Total = pagination.total do upstream adulto

### 7.4 Home / featured / search
- Mesmas rotas; policy por `SiteMode`  
- Busca no NSFW só retorna hits adultos  

## 8. Frontend — mudanças principais

| Área | Main | NSFW |
|------|------|------|
| `NEXT_PUBLIC_SITE_MODE` | `main` | `nsfw` |
| Layout / middleware | normal | auth + age-gate |
| `apiFetch` | header `X-Zipo-Site: main` | `X-Zipo-Site: nsfw` |
| Copy i18n | ZiPo | ZiPo NSFW (pt-BR) |
| Conteúdo adulto na UI | nunca | esperado (sem blur de “esconder”, já autenticado) |
| Link cruzado | opcional (fora do escopo v1) | opcional |

Página nova: `app/[locale]/age-gate/page.tsx` (só relevante no modo nsfw).

## 9. Config / env

```env
# Web main
NEXT_PUBLIC_SITE_MODE=main
NEXT_PUBLIC_SITE_NAME=ZiPo

# Web nsfw
NEXT_PUBLIC_SITE_MODE=nsfw
NEXT_PUBLIC_SITE_NAME=ZiPo NSFW
PORT=3002

# API
FRONTEND_URL=http://localhost:3000
NSFW_FRONTEND_URL=http://localhost:3002
CORS_ORIGINS=http://localhost:3000,http://localhost:3002,...
```

Scripts root:

```json
"dev:web:nsfw": "pnpm --filter @zipo/web dev:nsfw",
"dev:all:nsfw": "pnpm --parallel --filter @zipo/api --filter @zipo/web dev --filter ..."
```

(`@zipo/web`: `"dev:nsfw": "next dev -p 3002"` + carregar env NSFW)

## 10. Segurança e compliance

- NSFW nunca indexável: `X-Robots-Tag: noindex` + `robots.txt` disallow no modo nsfw  
- Main: garantia server-side (não confiar só no client)  
- Rate limit nos endpoints de confirm-adult  
- Logs: não registrar payloads sensíveis de imagens adultas  

## 11. Fora de escopo (v1)

- Contas separadas  
- Billing / paywall NSFW  
- App nativo separado  
- Link promocional main → nsfw  
- Moderação editorial manual de catálogo  

## 12. Critérios de aceite

1. Main `:3000` não lista nem abre hentai/ecchi/pornô  
2. NSFW `:3002` sem login → login  
3. NSFW logado sem confirmação → age-gate  
4. Após confirmar, home/catálogo NSFW mostram só adulto por tipo (movie/series/anime)  
5. Mesma conta funciona nos dois (re-login ok em localhost)  
6. Testes unitários: detectAdultContent (ecchi, Rx, TMDB adult) + policy main/nsfw + parse `includeAdult`  
7. Docs `DEV.md` atualizado com os dois comandos  

## 13. Plano de implementação (alto nível)

1. Shared: `SiteMode`, policy helpers, detecção ampliada (ecchi/porn)  
2. DB: `adult_confirmed_at` + endpoint confirm  
3. API: resolver site mode + aplicar policy em catalog/search/home/detail/playback  
4. Catalog NSFW: sources TMDB adult + Jikan hentai/ecchi  
5. Web: env mode, header, middleware auth/age-gate, i18n NSFW, scripts porta 3002  
6. CORS / env example / DEV.md  
7. Testes  

## 14. Riscos

| Risco | Mitigação |
|-------|-----------|
| TMDB adult TV escasso | Fallback Cinemeta + filtro isAdult |
| Cookie cross-port localhost | Re-login no NSFW em dev; cookie de domínio em prod |
| Falso positivo (R-17 violência) | Não marcar R-17 genérico; só Rx/R18/NC-17/ecchi/hentai/adult flag |
| Vazamento main | Policy na API obrigatória, testes de regressão |
