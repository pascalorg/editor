# syntax=docker/dockerfile:1

# Stage 1: deps
FROM oven/bun:1.3.0-alpine AS deps
WORKDIR /app

# Copy manifests needed for install (all workspace package.json + lockfile)
COPY bun.lock package.json ./
COPY apps/editor/package.json ./apps/editor/
COPY packages/core/package.json ./packages/core/
COPY packages/editor/package.json ./packages/editor/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/viewer/package.json ./packages/viewer/
COPY packages/ui/package.json ./packages/ui/
COPY tooling/ ./tooling/

RUN bun install --frozen-lockfile

# Stage 2: builder
FROM oven/bun:1.3.0-alpine AS builder
WORKDIR /app

# Copy all node_modules from deps stage (root + any per-workspace hoisted dirs)
COPY --from=deps /app/ .

# Copy full source on top (overwrites package.json stubs from deps)
COPY . .

# Skip runtime env validation at build time — vars injected at runtime
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1

RUN bun run build --filter=editor...

# Stage 3: runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Next.js standalone output
COPY --from=builder /app/apps/editor/.next/standalone ./
COPY --from=builder /app/apps/editor/.next/static ./apps/editor/.next/static
COPY --from=builder /app/apps/editor/public ./apps/editor/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/editor/server.js"]
