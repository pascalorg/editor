FROM oven/bun:1.3.0 as base
WORKDIR /usr/src/app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
COPY apps/editor/package.json ./apps/editor/
COPY packages/core/package.json ./packages/core/
COPY packages/editor/package.json ./packages/editor/
COPY packages/viewer/package.json ./packages/viewer/
COPY packages/ui/package.json ./packages/ui/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY tooling/typescript/package.json ./tooling/typescript/

RUN bun install --frozen-lockfile

# Build the project
FROM install AS build
COPY . .

# Skip env.mjs validation during build (references unused Supabase vars)
ENV SKIP_ENV_VALIDATION=1
ENV NODE_ENV=production

RUN cd apps/editor && bunx prisma generate
RUN bun run build

# Run the app
FROM base AS release

# Install OpenSSL (required by Prisma at runtime)
USER root
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=install /usr/src/app /usr/src/app

# Copy built Next.js app
COPY --from=build /usr/src/app/apps/editor/.next ./apps/editor/.next
COPY --from=build /usr/src/app/apps/editor/app ./apps/editor/app
COPY --from=build /usr/src/app/apps/editor/public ./apps/editor/public
COPY --from=build /usr/src/app/apps/editor/package.json ./apps/editor/package.json
COPY --from=build /usr/src/app/apps/editor/server.ts ./apps/editor/server.ts
COPY --from=build /usr/src/app/apps/editor/next.config.ts ./apps/editor/next.config.ts

# Copy Prisma schema + generated client (schema needed for db push at startup)
COPY --from=build /usr/src/app/apps/editor/prisma ./apps/editor/prisma

# Copy built package dist directories (required at runtime)
COPY --from=build /usr/src/app/packages/core/dist ./packages/core/dist
COPY --from=build /usr/src/app/packages/core/package.json ./packages/core/package.json
# @pascal-app/editor has no build step — it exports raw src via transpilePackages
COPY --from=build /usr/src/app/packages/editor/src ./packages/editor/src
COPY --from=build /usr/src/app/packages/editor/package.json ./packages/editor/package.json
COPY --from=build /usr/src/app/packages/viewer/dist ./packages/viewer/dist
COPY --from=build /usr/src/app/packages/viewer/package.json ./packages/viewer/package.json

# Copy root package.json for workspace resolution
COPY --from=build /usr/src/app/package.json ./package.json

# Copy entrypoint script
COPY apps/editor/entrypoint.sh ./apps/editor/entrypoint.sh
RUN chmod +x ./apps/editor/entrypoint.sh

ENV NODE_ENV=production

WORKDIR /usr/src/app/apps/editor
EXPOSE 3002
ENTRYPOINT [ "./entrypoint.sh" ]

