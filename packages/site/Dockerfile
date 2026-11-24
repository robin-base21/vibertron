# Build context: repo root (see docker-compose.yml)
FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/site/package.json packages/site/
RUN bun install --frozen-lockfile
COPY packages/common packages/common
COPY packages/site packages/site
WORKDIR /app/packages/site
RUN bun run build

FROM oven/bun:1.4 AS runner
WORKDIR /app
# adapter-node leaves `dependencies` external; keep the workspace layout so bun's isolated
# linker finds them (see packages/frontend/Dockerfile).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/common packages/common
COPY --from=builder /app/packages/site/node_modules packages/site/node_modules
COPY --from=builder /app/packages/site/build packages/site/build
COPY --from=builder /app/packages/site/drizzle packages/site/drizzle
COPY --from=builder /app/packages/site/package.json packages/site/
WORKDIR /app/packages/site
ENV NODE_ENV=production \
    PORT=3100 \
    SITE_DATABASE_PATH=/data/site.sqlite \
    SITE_DATA_DIR=/data \
    SITE_MIGRATIONS=/app/packages/site/drizzle \
    BODY_SIZE_LIMIT=200M
VOLUME ["/data"]
EXPOSE 3100
# Runs on Bun: the server uses bun:sqlite.
CMD ["bun", "build/index.js"]
