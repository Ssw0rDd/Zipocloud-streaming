# Contributing to ZiPo

Ship small, purposeful changes with risk described up front. Do not include credentials, temporary media URLs, production dumps, or unauthorized content.

**Docs:** [Setup](docs/SETUP.md) · [Configuration](docs/CONFIGURATION.md) · [Third-party APIs](docs/THIRD_PARTY_APIS.md) · [README](README.md)

## Environment

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Recommended: TMDB_ACCESS_TOKEN — see docs/THIRD_PARTY_APIS.md
docker compose up -d postgres redis minio minio-init
pnpm db:migrate
pnpm dev:all
```

Public contracts must stay backwards-compatible or land with an ADR. Validate at the edge, derive identity from the session, and keep outbound requests on HTTPS allowlists with timeouts, byte limits, and DNS checks.

## Pre-PR gate

```bash
pnpm lint
pnpm typecheck
pnpm test:security
pnpm --filter @zipo/api test
pnpm test:sdk
pnpm pentest:static
pnpm check:supply-chain
pnpm build
pnpm check:artifacts
pnpm --filter @zipo/web check:bundle
```

Stream Bridge changes also require `python -m pytest tests -q` and `python -m pip check` inside `services/zipo-stream-bridge`. UI changes need keyboard, focus, contrast, and `prefers-reduced-motion` checks.

## Commits and documentation

Record durable decisions under `docs/decisions/`, update `docs/API.md` when routes change, and keep SDK examples runnable. CI pins dependencies, containers, and Actions; bumps must pass the same gates.

---

## Contribuindo (pt-BR)

Abra mudanças pequenas, com propósito e risco descritos. Não inclua credenciais, URLs temporárias de mídia, dumps de produção ou conteúdo sem autorização.

Guias: [Setup](docs/SETUP.md) · [Configuração](docs/CONFIGURATION.md) · [APIs de terceiros](docs/THIRD_PARTY_APIS.md)

```bash
pnpm install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres redis minio minio-init
pnpm db:migrate
pnpm dev:all
```

Antes do PR, rode o mesmo gate da seção em inglês. Decisões duráveis em `docs/decisions/`; altere `docs/API.md` junto com rotas públicas.
