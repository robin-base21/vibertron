# Build context: repo root (see docker-compose.yml)
FROM oven/bun:1 AS builder
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

FROM oven/bun:1 AS runner
WORKDIR /app
COPY --from=builder /app/packages/frontend/build ./build
COPY --from=builder /app/packages/frontend/package.json ./
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["bun", "build/index.js"]
