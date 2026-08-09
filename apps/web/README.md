# ZiPo Web

Next.js 15 frontend for the ZiPo streaming platform.

## Dev

```bash
# From monorepo root
pnpm install
pnpm --filter @zipo/web dev

# Or from apps/web
pnpm dev
```

Open http://localhost:3000 (redirects to `/pt`).

## Env

```env
API_URL=http://localhost:3001
```

The browser always calls same-origin `/api`. Provider credentials and upstream URLs remain server-only.

## Stack

- Next.js 15 App Router
- Tailwind CSS v4
- Framer Motion
- next-intl (9 locales)
- TanStack Query
- @zipo/api-client (framework-agnostic Fetch SDK)
