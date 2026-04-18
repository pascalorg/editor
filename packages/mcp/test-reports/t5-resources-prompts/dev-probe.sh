#!/usr/bin/env bash
# T5 — Next.js dev server probe.
#
# Verifies http://localhost:3002 is serving the Pascal editor cleanly without
# touching the running process.
#
# Outputs structured "KEY=value" lines so the REPORT.md can be authored from
# them, plus a longer human-readable summary at the end.

set -uo pipefail

URL_ROOT="http://localhost:3002/"
URL_HEALTH="http://localhost:3002/api/health"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

ROOT_BODY="$TMPDIR/root.html"
ROOT_HEAD="$TMPDIR/root.head"
HEALTH_BODY="$TMPDIR/health.body"
HEALTH_HEAD="$TMPDIR/health.head"

echo "## Probe: $URL_ROOT"
ROOT_STATUS=$(curl -sS --connect-timeout 5 --max-time 30 \
  -o "$ROOT_BODY" -D "$ROOT_HEAD" -w '%{http_code}' "$URL_ROOT" || echo "000")
ROOT_BYTES=$(wc -c < "$ROOT_BODY" | tr -d ' ')

echo "ROOT_STATUS=$ROOT_STATUS"
echo "ROOT_BYTES=$ROOT_BYTES"

# Pascal mention: explicit "Pascal" string OR @pascal-app reference.
if grep -q -i 'Pascal' "$ROOT_BODY"; then
  ROOT_HAS_PASCAL=1
else
  ROOT_HAS_PASCAL=0
fi
if grep -q '@pascal-app' "$ROOT_BODY"; then
  ROOT_HAS_PASCAL_APP=1
else
  ROOT_HAS_PASCAL_APP=0
fi
echo "ROOT_HAS_PASCAL=$ROOT_HAS_PASCAL"
echo "ROOT_HAS_PASCAL_APP=$ROOT_HAS_PASCAL_APP"

# Count <script src="..."> tags.
SCRIPT_COUNT=$(grep -o '<script [^>]*src="[^"]*"' "$ROOT_BODY" | wc -l | tr -d ' ')
NEXT_CHUNK_COUNT=$(grep -o '<script [^>]*src="[^"]*_next[^"]*"' "$ROOT_BODY" | wc -l | tr -d ' ')
# Best-effort search for editor / viewer / core chunks (workspace wiring sanity).
EDITOR_CHUNK_COUNT=$(grep -o -E '<script [^>]*src="[^"]*(editor|viewer|core|three|gltf)[^"]*"' "$ROOT_BODY" | wc -l | tr -d ' ')

echo "SCRIPT_COUNT=$SCRIPT_COUNT"
echo "NEXT_CHUNK_COUNT=$NEXT_CHUNK_COUNT"
echo "EDITOR_VIEWER_CORE_CHUNK_COUNT=$EDITOR_CHUNK_COUNT"

# Error indicator scan.
ERR_APP_ERROR=$(grep -c 'Application error' "$ROOT_BODY" || true)
ERR_FAILED_TO=$(grep -c 'Failed to' "$ROOT_BODY" || true)
ERR_CANNOT=$(grep -c 'cannot' "$ROOT_BODY" || true)

echo "ERR_APP_ERROR=$ERR_APP_ERROR"
echo "ERR_FAILED_TO=$ERR_FAILED_TO"
echo "ERR_CANNOT=$ERR_CANNOT"

# Print first ~5 unique script sources for sanity inspection (cap output).
echo
echo "## First script src= matches (max 10)"
grep -o '<script [^>]*src="[^"]*"' "$ROOT_BODY" | sed -E 's/.*src="([^"]+)".*/\1/' | head -10 || true

# /api/health probe (best effort — endpoint may not exist).
echo
echo "## Probe: $URL_HEALTH"
HEALTH_STATUS=$(curl -sS --connect-timeout 5 --max-time 10 \
  -o "$HEALTH_BODY" -D "$HEALTH_HEAD" -w '%{http_code}' "$URL_HEALTH" || echo "000")
HEALTH_BYTES=$(wc -c < "$HEALTH_BODY" | tr -d ' ')
echo "HEALTH_STATUS=$HEALTH_STATUS"
echo "HEALTH_BYTES=$HEALTH_BYTES"

# If the response is JSON, show first 200 bytes; otherwise mark as N/A.
if [ "$HEALTH_STATUS" = "200" ]; then
  HEALTH_BODY_TEXT=$(head -c 200 "$HEALTH_BODY" | tr -d '\n')
  echo "HEALTH_BODY_PREVIEW=$HEALTH_BODY_TEXT"
fi

# Brief title extraction.
TITLE_LINE=$(grep -o '<title>[^<]*</title>' "$ROOT_BODY" | head -1 || true)
echo
echo "ROOT_TITLE=$TITLE_LINE"

# Final aggregate verdict.
echo
echo "## Summary"
if [ "$ROOT_STATUS" = "200" ] && \
   { [ "$ROOT_HAS_PASCAL" = "1" ] || [ "$ROOT_HAS_PASCAL_APP" = "1" ]; } && \
   [ "$ERR_APP_ERROR" = "0" ]; then
  echo "DEV_VERDICT=PASS"
else
  echo "DEV_VERDICT=FAIL"
fi
