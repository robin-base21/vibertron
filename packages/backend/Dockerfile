# Build context: repo root (see docker-compose.yml)
FROM oven/bun:1.4 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock* ./
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN bun install --frozen-lockfile --filter backend

FROM base AS release
# bun's isolated linker puts each package's deps in packages/*/node_modules (symlinks into the
# root .bun store), so copy those too, not just the root node_modules.
COPY --from=install /app/node_modules ./node_modules
COPY --from=install /app/packages/common/node_modules packages/common/node_modules
COPY --from=install /app/packages/backend/node_modules packages/backend/node_modules
COPY packages/common packages/common
COPY packages/backend packages/backend
WORKDIR /app/packages/backend
ENV NODE_ENV=production \
    PORT=3001 \
    DATABASE_PATH=/data/vibertron.sqlite \
    UPLOAD_DIR=/data/uploads
VOLUME ["/data"]
EXPOSE 3001
# Migrate, seed the admin (idempotent; skipped when ADMIN_EMAIL/ADMIN_PASSWORD are unset), then serve.
CMD ["sh", "-c", "bun run src/db/migrate.ts && bun run src/db/seed.ts && exec bun run index.ts"]
