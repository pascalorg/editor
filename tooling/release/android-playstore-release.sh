#!/usr/bin/env bash
set -euo pipefail

# Android Play Store Release Script
# Usage: bash tooling/release/android-playstore-release.sh [track]
#   track: internal (default), alpha, beta, production

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TRACK="${1:-internal}"
POLL_SECONDS="${POLL_SECONDS:-30}"
MAX_POLLS="${MAX_POLLS:-40}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd eas
require_cmd python3
require_cmd rg
require_cmd git

if [[ ! -f "$ROOT_DIR/.env.local" ]]; then
  echo "Missing .env.local at repo root." >&2
  exit 1
fi

set -a
source "$ROOT_DIR/.env.local"
set +a

# Validate Google Play credentials
GOOGLE_SA_PATH="${GOOGLE_SERVICE_ACCOUNT:-}"
if [[ -z "$GOOGLE_SA_PATH" ]]; then
  echo "GOOGLE_SERVICE_ACCOUNT is not set in .env.local." >&2
  exit 1
fi

# Resolve relative path (relative to apps/native/)
if [[ "$GOOGLE_SA_PATH" == ../../* ]]; then
  GOOGLE_SA_ABS="$ROOT_DIR/${GOOGLE_SA_PATH#../../}"
elif [[ "$GOOGLE_SA_PATH" != /* ]]; then
  GOOGLE_SA_ABS="$ROOT_DIR/$GOOGLE_SA_PATH"
else
  GOOGLE_SA_ABS="$GOOGLE_SA_PATH"
fi

if [[ ! -f "$GOOGLE_SA_ABS" ]]; then
  echo "Google service account JSON not found: $GOOGLE_SA_ABS" >&2
  exit 1
fi

MAIN_SHA="$(git -C "$ROOT_DIR" rev-parse main)"
WORKTREE_DIR="$(mktemp -d /tmp/pascal-release-android-XXXXXX)"

cleanup() {
  if git -C "$ROOT_DIR" worktree list --porcelain | rg -q "^worktree ${WORKTREE_DIR}$"; then
    git -C "$ROOT_DIR" worktree remove --force "$WORKTREE_DIR" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKTREE_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Creating clean detached worktree from main ($MAIN_SHA)..."
git -C "$ROOT_DIR" worktree add --detach "$WORKTREE_DIR" "$MAIN_SHA" >/dev/null

cp "$ROOT_DIR/.env.local" "$WORKTREE_DIR/.env.local"
cp "$GOOGLE_SA_ABS" "$WORKTREE_DIR/apps/native/$(basename "$GOOGLE_SA_ABS")"

if [[ -d "$ROOT_DIR/node_modules" && ! -e "$WORKTREE_DIR/node_modules" ]]; then
  ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/node_modules"
fi
if [[ -d "$ROOT_DIR/apps/native/node_modules" && ! -e "$WORKTREE_DIR/apps/native/node_modules" ]]; then
  ln -s "$ROOT_DIR/apps/native/node_modules" "$WORKTREE_DIR/apps/native/node_modules"
fi

echo "Starting EAS Android production build with auto-submit (track: $TRACK)..."
pushd "$WORKTREE_DIR/apps/native" >/dev/null
set -a
source "$WORKTREE_DIR/.env.local"
set +a

BUILD_OUTPUT="$(eas build --platform android --profile production --auto-submit --non-interactive --no-wait --json 2>&1)"
echo "$BUILD_OUTPUT"

BUILD_ID="$(printf '%s\n' "$BUILD_OUTPUT" | rg -o 'builds/[0-9a-f-]{36}' | head -n1 | cut -d/ -f2 || true)"
if [[ -z "$BUILD_ID" ]]; then
  echo "Could not parse EAS build ID from output." >&2
  exit 1
fi
popd >/dev/null

echo "Build started: $BUILD_ID"

BUILD_STATUS=""
BUILD_VERSION=""
BUILD_COMMIT=""
for ((i = 1; i <= MAX_POLLS; i++)); do
  VIEW_OUTPUT="$(cd "$WORKTREE_DIR/apps/native" && eas build:view "$BUILD_ID" --json 2>&1 || true)"
  META="$(python3 - "$VIEW_OUTPUT" <<'PY'
import json, sys
s = sys.argv[1]
start = s.find('{')
end = s.rfind('}')
if start == -1 or end == -1 or end <= start:
    print("\n\n")
    raise SystemExit(0)
obj = json.loads(s[start:end+1])
print(obj.get("status", ""))
print(obj.get("appBuildVersion", "") or obj.get("appVersion", ""))
print(obj.get("gitCommitHash", ""))
PY
)"
  BUILD_STATUS="$(printf '%s\n' "$META" | sed -n '1p')"
  BUILD_VERSION="$(printf '%s\n' "$META" | sed -n '2p')"
  BUILD_COMMIT="$(printf '%s\n' "$META" | sed -n '3p')"

  if [[ "$BUILD_STATUS" == "FINISHED" ]]; then
    break
  fi
  if [[ "$BUILD_STATUS" == "ERRORED" || "$BUILD_STATUS" == "CANCELED" ]]; then
    echo "Build $BUILD_ID ended with status: $BUILD_STATUS" >&2
    exit 1
  fi
  echo "[$i/$MAX_POLLS] EAS build status: ${BUILD_STATUS:-unknown} (waiting ${POLL_SECONDS}s)"
  sleep "$POLL_SECONDS"
done

if [[ "$BUILD_STATUS" != "FINISHED" ]]; then
  echo "Timed out waiting for EAS build completion." >&2
  exit 1
fi

if [[ -n "$BUILD_COMMIT" && "$BUILD_COMMIT" != "$MAIN_SHA" ]]; then
  echo "Warning: build commit $BUILD_COMMIT differs from main $MAIN_SHA" >&2
fi

echo
echo "=== Android Release Summary ==="
echo "  EAS build id:      $BUILD_ID"
echo "  Build version:     ${BUILD_VERSION:-unknown}"
echo "  Build commit:      ${BUILD_COMMIT:-unknown}"
echo "  Play Store track:  $TRACK"
echo "  EAS submissions:   https://expo.dev/accounts/pascalorg/projects/pascal/submissions"
echo
echo "EAS auto-submit will upload the AAB to the Play Store '$TRACK' track."
echo "Check the Google Play Console for processing status."
echo "To promote to production: Google Play Console > Release > Production > Create new release"
