FROM oven/bun:1.3.0-alpine
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile
RUN touch apps/editor/.env.local
RUN ./node_modules/.bin/turbo run build --filter=editor

EXPOSE 3000
WORKDIR /app/apps/editor
CMD ["bun", "run", "start"]
