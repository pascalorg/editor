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
COPY tooling/tailwind/package.json ./tooling/tailwind/

RUN bun install --frozen-lockfile

# Build the project
FROM install AS build
COPY . .
RUN cd apps/editor && bunx prisma generate
RUN bun run build

# Run the app
FROM base AS release
COPY --from=install /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/apps/editor/.next ./apps/editor/.next
COPY --from=build /usr/src/app/apps/editor/public ./apps/editor/public
COPY --from=build /usr/src/app/apps/editor/package.json ./apps/editor/package.json
COPY --from=build /usr/src/app/package.json ./package.json

USER bun
EXPOSE 3002
ENTRYPOINT [ "bun", "run", "apps/editor/server.ts" ]
