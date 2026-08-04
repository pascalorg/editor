# Matches `packageManager` in package.json and the version CI installs — a skew
# here is what makes `--frozen-lockfile` fail inside the image but not locally.
FROM oven/bun:1.3.14-alpine
WORKDIR /app

# `next build` runs under `node`, and this image's `node` is a shim that re-execs
# bun (/usr/local/bun-node-fallback-bin/node). Next 16's build crashes it — a
# segfault on 1.3.14, a turbopack CommonJS wrapper error on 1.3.0 — on both arm64
# and amd64. CI does not hit this because GitHub runners have a real node.
RUN apk add --no-cache nodejs

COPY . .
RUN bun install --frozen-lockfile
RUN ./node_modules/.bin/turbo run build --filter=editor

# Saved scenes live in SQLite under PASCAL_DATA_DIR; owned by the runtime user so
# the store can create the database on first write.
RUN mkdir -p /data && chown -R bun:bun /data /app
ENV PASCAL_DATA_DIR=/data
VOLUME /data

USER bun
EXPOSE 3000
WORKDIR /app/apps/editor
CMD ["bun", "run", "start"]
