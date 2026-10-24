# syntax=docker/dockerfile:1

# Matches `packageManager` in package.json and the version CI installs — a skew
# here is what makes `--frozen-lockfile` fail inside the image but not locally.
FROM oven/bun:1.4.4-alpine AS build
WORKDIR /app

# `next build` runs under `node`, and this image's `node` is a shim that re-execs
# bun (/usr/local/bun-node-fallback-bin/node). Next 16's build crashes it — a
# segfault on 1.3.14, a turbopack CommonJS wrapper error on 1.3.0 — on both arm64
# and amd64. CI does not hit this because GitHub runners have a real node.
RUN apk add --no-cache nodejs

COPY . .
RUN bun install --frozen-lockfile

# The image ships the same portable runtime as `npx @pascal-app/cli editor`:
# Next's standalone output, pruned of sources and build-only files by the CLI's
# staging script. One artifact, two distribution channels.
ENV PASCAL_PORTABLE_BUILD=1
RUN ./node_modules/.bin/turbo run build --filter=editor
RUN cd packages/cli && bun run build && bun run stage-runtime

FROM node:22.23.4-alpine
WORKDIR /app

# GHCR reads these: the package page links to the repository, shows its
# README and inherits its access, and the licence is declared on the image.
LABEL org.opencontainers.image.title="Pascal editor" \
      org.opencontainers.image.description="Self-hosted Pascal, the open-source 3D architecture editor: one container, projects in SQLite under /data." \
      org.opencontainers.image.source="https://github.com/pascalorg/editor" \
      org.opencontainers.image.documentation="https://github.com/pascalorg/editor/blob/main/SETUP.md" \
      org.opencontainers.image.url="https://editor.pascal.app" \
      org.opencontainers.image.vendor="Pascal" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    PASCAL_DATA_DIR=/data

COPY --from=build --chown=node:node /app/packages/cli/build/runtime ./

# Saved scenes live in SQLite under PASCAL_DATA_DIR; owned by the runtime user so
# the store can create the database on first write.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/editor/server.js"]
