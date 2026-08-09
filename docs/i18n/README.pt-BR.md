<p align="center">
  <img
    src="https://raw.githubusercontent.com/Ssw0rDd/Zipocloud-streaming/main/docs/assets/zipo-banner.svg"
    alt="ZiPo — monorepo de streaming self-hosted"
    width="720"
  />
</p>

<p align="center">
  <a href="../../README.md">English</a>
  ·
  <strong>Português (Brasil)</strong>
  ·
  <a href="README.zh-CN.md">简体中文</a>
</p>

# ZiPo

**ZiPo** é uma plataforma de streaming self-hosted em monorepo: catálogo rico, autenticação e perfis, player moderno, clips, salas de cinema sincronizadas, apoio opcional via Pix (apoiador vitalício) e entrega de mídia própria/licenciada. Inclui um SDK TypeScript público e um web component de login.

Use apenas mídia própria, licenciada ou permitida pelos termos de cada provedor. Segredos e autorização ficam no servidor — nunca no navegador.

## O que é o ZiPo?

Uma stack completa para rodar uma experiência de descoberta estilo Netflix na sua infraestrutura:

- **Catálogo** — filmes, séries e anime a partir de fontes públicas (TMDB e outras), com enriquecimento progressivo.
- **Contas e perfis** — Better Auth, multi-perfil, histórico e playlists.
- **Player** — foco em HLS nativo, embeds opcionais configurados pelo operador, flags Anime4K, sites dual main/NSFW.
- **Cinema** — salas com chat/presença e sync quando há stream nativo.
- **Clips e jobs** — worker FFmpeg e Stream Bridge opcionais para mídia autorizada.
- **SDK** — `@zipo/api-client` e `<zipo-auth>` para integrar fora do site principal.

## Início rápido

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Recomendado: TMDB_ACCESS_TOKEN — veja docs/THIRD_PARTY_APIS.md
docker compose up -d postgres redis minio minio-init
pnpm db:migrate
pnpm dev:all
```

- Web: http://localhost:3000  
- API: http://localhost:3001  

Guia completo: **[Setup](../SETUP.md)** · **[Configuração](../CONFIGURATION.md)** · **[APIs de terceiros](../THIRD_PARTY_APIS.md)**

## Chaves e integrações

| Integração | Variáveis | Onde obter |
|---|---|---|
| TMDB (recomendado) | `TMDB_ACCESS_TOKEN` | [configurações de API](https://www.themoviedb.org/settings/api) |
| Trakt | `TRAKT_CLIENT_ID` | [aplicativos Trakt](https://trakt.tv/oauth/applications) |
| OMDb | `OMDB_API_KEY` | [chave OMDb](https://www.omdbapi.com/apikey.aspx) |
| AniList | `ANILIST_CLIENT_*` | [developer AniList](https://anilist.co/settings/developer) |
| Mercado Pago Pix | `MERCADO_PAGO_*` | [Developers](https://www.mercadopago.com.br/developers) |

Provedores de playback opcionais vêm **desligados** no [`.env.example`](../../.env.example). Habilite só fontes que você opera ou licencia. Credenciais de providers privados de operadores **não** são documentadas no repositório público.

## Arquitetura

| Camada | Stack |
|---|---|
| Web | Next.js 15, React 19, TypeScript, next-intl |
| API | Bun, Elysia, Better Auth, Drizzle |
| Estado | PostgreSQL, Redis, MinIO/S3 privado |
| Pacotes | `@zipo/api-client`, `@zipo/auth-ui` |

Detalhes: [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) · [README principal (EN)](../../README.md)

## Documentação

- [Setup](../SETUP.md) · [Configuration](../CONFIGURATION.md) · [Third-party APIs](../THIRD_PARTY_APIS.md)
- [API HTTP](../API.md) · [SDK](../SDK.md) · [Deploy](../DEPLOYMENT.md) · [Dev](../DEV.md)
- [Contribuindo](../../CONTRIBUTING.md) · [Segurança](../../SECURITY.md)

Licença: [MIT](../../LICENSE).
