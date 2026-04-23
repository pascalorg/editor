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
RUN cd apps/editor && bunx prisma generate
RUN bun run build

# Run the app
FROM base AS release
COPY --from=install /usr/src/app /usr/src/app
COPY --from=build /usr/src/app/apps/editor/.next ./apps/editor/.next
COPY --from=build /usr/src/app/apps/editor/app ./apps/editor/app
COPY --from=build /usr/src/app/apps/editor/public ./apps/editor/public
COPY --from=build /usr/src/app/apps/editor/package.json ./apps/editor/package.json
COPY --from=build /usr/src/app/apps/editor/server.ts ./apps/editor/server.ts
COPY --from=build /usr/src/app/apps/editor/next.config.ts ./apps/editor/next.config.ts
COPY --from=build /usr/src/app/apps/editor/prisma/generated-client ./apps/editor/prisma/generated-client
COPY --from=build /usr/src/app/package.json ./package.json

USER bun
WORKDIR /usr/src/app/apps/editor
EXPOSE 3002
ENTRYPOINT [ "bun", "run", "server.ts" ]
