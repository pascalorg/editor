#!/bin/sh
set -e

echo "→ Pushing Prisma schema to database..."
bunx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠ Prisma db push failed (DB may not be ready yet, retrying in 5s...)"
sleep 5
bunx prisma db push --skip-generate --accept-data-loss 2>&1 || echo "⚠ Prisma db push failed after retry"

echo "→ Starting Archly server..."
exec bun run server.ts
