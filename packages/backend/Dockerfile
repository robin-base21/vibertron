# Build context: repo root (see docker-compose.yml)
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* ./
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN bun install --frozen-lockfile --filter backend

FROM base AS release
COPY --from=install /app/node_modules ./node_modules
COPY packages/common packages/common
COPY packages/backend packages/backend
WORKDIR /app/packages/backend
EXPOSE 3001
CMD ["sh", "-c", "bun run src/db/migrate.ts && bun run index.ts"]
