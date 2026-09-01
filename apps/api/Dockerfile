FROM oven/bun:1.4.0-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN apk add --no-cache nodejs && bun install -g pnpm@10.34.5 && pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
WORKDIR /app/apps/api
RUN bun run build

FROM oven/bun:1.4.0-alpine AS runner
WORKDIR /app/apps/api
ENV NODE_ENV=production
RUN apk add --no-cache ffmpeg
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
USER bun
EXPOSE 3001
CMD ["sh", "-c", "bun run dist/migrate.js && bun run dist/index.js"]
