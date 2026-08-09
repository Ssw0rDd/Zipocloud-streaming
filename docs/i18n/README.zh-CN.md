<p align="center">
  <img
    src="https://raw.githubusercontent.com/Ssw0rDd/Zipocloud-streaming/main/docs/assets/zipo-banner.svg"
    alt="ZiPo — 自托管流媒体 monorepo"
    width="720"
  />
</p>

<p align="center">
  <a href="../../README.md">English</a>
  ·
  <a href="README.pt-BR.md">Português (Brasil)</a>
  ·
  <strong>简体中文</strong>
</p>

# ZiPo

**ZiPo** 是一个自托管流媒体平台 monorepo：丰富片库、账号与多档案、现代播放器、短片段、同步影厅、可选 Pix「终身支持者」支付，以及在你拥有或获得授权时进行的自有媒体分发。同时提供公开 TypeScript SDK 与可嵌入的登录 Web Component。

请仅使用你自有、已获授权，或符合各提供方服务条款的媒体。密钥与鉴权决策属于服务端，不得放在浏览器中。

## ZiPo 是什么？

在你可控的基础设施上运行完整的影音发现体验：

- **片库优先** — 电影 / 剧集 / 动画元数据（TMDB 等）与渐进富集  
- **账号与档案** — Better Auth、多档案、观看历史与播放列表  
- **播放器** — 以原生 HLS 为主，可选运营方配置的嵌入回退、Anime4K 开关、主站 / NSFW 双站  
- **影厅** — 聊天 / 在线状态，在原生流就绪时同步播放  
- **Clips 与媒体任务** — 可选 FFmpeg worker 与 Stream Bridge（仅限合法介质）  
- **SDK** — `@zipo/api-client` 与 `<zipo-auth>`，便于站外集成  

## 快速开始

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# 建议配置 TMDB_ACCESS_TOKEN，见 docs/THIRD_PARTY_APIS.md
docker compose up -d postgres redis minio minio-init
pnpm db:migrate
pnpm dev:all
```

| 服务 | 地址 |
|---|---|
| Web（主站） | http://localhost:3000 |
| API | http://localhost:3001 |

完整步骤：**[安装配置](../SETUP.md)** · **[环境变量](../CONFIGURATION.md)** · **[第三方 API](../THIRD_PARTY_APIS.md)**

## API 密钥与集成

| 集成 | 环境变量 | 申请入口 |
|---|---|---|
| TMDB（推荐） | `TMDB_ACCESS_TOKEN` | [TMDB API 设置](https://www.themoviedb.org/settings/api) · [文档](https://developer.themoviedb.org/docs) |
| Trakt（可选） | `TRAKT_CLIENT_ID` | [Trakt 应用](https://trakt.tv/oauth/applications) |
| OMDb（可选） | `OMDB_API_KEY` | [申请密钥](https://www.omdbapi.com/apikey.aspx) |
| AniList（可选 OAuth） | `ANILIST_CLIENT_ID` / `SECRET` | [开发者设置](https://anilist.co/settings/developer) |
| Mercado Pago Pix | `MERCADO_PAGO_*` | [开发者中心](https://www.mercadopago.com.br/developers) |

可选播放源的 `*_BASE_URL` 由运营方自行配置，在 [`.env.example`](../../.env.example) 中**默认关闭**。仅开启你运营或获授权的来源。仓库**不公开**私有播放提供方的注册说明。

## 架构一览

| 层级 | 技术 |
|---|---|
| Web | Next.js 15、React 19、TypeScript、next-intl |
| API | Bun、Elysia、Better Auth、Drizzle |
| 状态 | PostgreSQL、Redis、私有 MinIO/S3 |
| 公开包 | `@zipo/api-client`、`@zipo/auth-ui` |

更多内容见英文主文档：[README.md](../../README.md) 与 [ARCHITECTURE.md](../architecture/ARCHITECTURE.md)。

## 文档索引

- [Setup](../SETUP.md) · [Configuration](../CONFIGURATION.md) · [Third-party APIs](../THIRD_PARTY_APIS.md)  
- [HTTP API](../API.md) · [SDK](../SDK.md) · [Deployment](../DEPLOYMENT.md) · [Local dev](../DEV.md)  
- [Contributing](../../CONTRIBUTING.md) · [Security](../../SECURITY.md)  

许可证：[MIT](../../LICENSE)。
