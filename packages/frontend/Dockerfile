# Build context: repo root (see docker-compose.yml)
FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json bun.lock* ./
COPY packages/common/package.json packages/common/
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
RUN bun install --frozen-lockfile
COPY packages/common packages/common
COPY packages/frontend packages/frontend
WORKDIR /app/packages/frontend
RUN bun run build

FROM oven/bun:1.4 AS runner
WORKDIR /app
# adapter-node leaves `dependencies` external, so the server needs them at runtime. Keep the
# workspace layout: bun's isolated linker links them from packages/*/node_modules.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/common packages/common
COPY --from=builder /app/packages/frontend/node_modules packages/frontend/node_modules
COPY --from=builder /app/packages/frontend/build packages/frontend/build
COPY --from=builder /app/packages/frontend/package.json packages/frontend/
WORKDIR /app/packages/frontend
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["bun", "build/index.js"]
