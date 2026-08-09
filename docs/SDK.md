# SDK público e autenticação pronta

## `@zipo/api-client`

Cliente ESM autocontido, baseado em Fetch, compatível com browsers, Bun e
Node.js 20+. As declarações publicadas não importam pacotes privados do
monorepo, e o build não inclui source maps.

```ts
import { createApiClient, ZipoApiError } from "@zipo/api-client";

const client = createApiClient({
  baseUrl: "https://zipo.example.com",
  timeoutMs: 10_000,
  credentials: "include",
  headers: { "X-ZiPo-Site": "main" },
});

try {
  const content = await client.content("movie", "tt1160419", "pt-BR");
  console.log(content.title);
} catch (error) {
  if (error instanceof ZipoApiError) {
    console.error(error.status, error.code, error.requestId);
  }
}
```

### Interface estável

| Método | Resultado |
|---|---|
| `health()` | saúde agregada |
| `getSession()` | sessão ou `null` |
| `signIn(input)` / `signUp(input)` / `signOut()` | autenticação |
| `account()` | conta atual |
| `search(query, options)` | busca tipada |
| `content(type, id, locale)` | detalhe |
| `aggregate(type, id, options)` | manifesto agregado |
| `discoverPlayback(type, id, options)` | fontes habilitadas |
| `comments(...)` / `createComment(...)` | comentários |
| `createClip(input)` | job de clip |
| `playlists()` / `playlist(id)` | playlists próprias |
| `donationConfig()` / `createPixOrder(key)` | apoio Pix |
| `request<T>(path, options)` | extensão para rotas ainda não encapsuladas |

Cada request combina timeout e `AbortSignal`, normaliza falhas HTTP em
`ZipoApiError` e preserva `X-Request-ID`. Para chamadas cross-origin com cookie,
o servidor precisa allowlistar a origem exata e responder por HTTPS.

## `@zipo/auth-ui`

`<zipo-auth>` é um Custom Element sem framework, com Shadow DOM, tema
vermelho/preto, tipografia Bricolage Grotesque/Manrope, foco visível,
responsividade e animações compatíveis com `prefers-reduced-motion`.

```html
<zipo-auth
  api-base="https://zipo.example.com"
  brand="Minha plataforma"
  locale="pt"
  mode="both"
  redirect-url="/pt/profile"
></zipo-auth>

<script type="module">
  import "@zipo/auth-ui";

  const auth = document.querySelector("zipo-auth");
  auth.addEventListener("zipo-auth-success", ({ detail }) => {
    console.log(detail.session.user.id);
  });
  auth.addEventListener("zipo-auth-error", ({ detail }) => {
    console.error(detail.code, detail.status);
  });
</script>
```

| Atributo | Valores | Padrão |
|---|---|---|
| `api-base` | origem da API | same-origin |
| `brand` | até 40 caracteres | `Acesso ZiPo` |
| `locale` | `pt`, `en` | `pt` |
| `mode` | `both`, `sign-in`, `sign-up` | `both` |
| `redirect-url` | URL relativa/same-origin | sem redirect |

Eventos `zipo-auth-success` e `zipo-auth-error` atravessam o Shadow DOM. O
componente não usa `localStorage`, `sessionStorage` ou `IndexedDB` para senha ou
sessão; cookies são controlados pelo backend.

## Publicação

```bash
pnpm --filter @zipo/api-client build
pnpm --filter @zipo/auth-ui build
pnpm --filter @zipo/api-client pack
pnpm --filter @zipo/auth-ui pack
```

Antes de publicar, execute `pnpm test:sdk`, `pnpm check:artifacts` e inspecione o
tarball. A publicação no registry é uma ação separada e requer autorização do
mantenedor.
