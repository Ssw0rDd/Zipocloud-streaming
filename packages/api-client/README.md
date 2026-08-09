# @zipo/api-client

SDK TypeScript sem dependência de framework para browsers, Bun e Node.js 20+.

```ts
import { createApiClient } from "@zipo/api-client";

const zipo = createApiClient("https://zipo.example.com");
const results = await zipo.search("Duna", { type: "movie" });
```

Sessões usam cookies seguros; em integrações cross-origin, configure a origem
no servidor e mantenha `credentials: "include"`.
