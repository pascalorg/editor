#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-1.0}"
POLL_SECONDS="${POLL_SECONDS:-30}"
MAX_POLLS="${MAX_POLLS:-40}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd eas
require_cmd asc
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

export ASC_KEY_ID="${ASC_KEY_ID:-${ASC_API_KEY_ID:-}}"
export ASC_ISSUER_ID="${ASC_ISSUER_ID:-${ASC_API_KEY_ISSUER_ID:-}}"
export ASC_APP_ID="${ASC_APP_ID:-}"

if [[ -z "${ASC_KEY_ID}" || -z "${ASC_ISSUER_ID}" || -z "${ASC_APP_ID}" ]]; then
  echo "ASC credentials are incomplete. Expected ASC_APP_ID and ASC_API_KEY_* (or ASC_*)." >&2
  exit 1
fi

if [[ -z "${ASC_PRIVATE_KEY_PATH:-}" ]]; then
  ASC_PRIVATE_KEY_PATH="$ROOT_DIR/AuthKey_${ASC_KEY_ID}.p8"
fi
if [[ ! -f "$ASC_PRIVATE_KEY_PATH" ]]; then
  echo "ASC private key not found: $ASC_PRIVATE_KEY_PATH" >&2
  exit 1
fi
export ASC_PRIVATE_KEY_PATH

MAIN_SHA="$(git -C "$ROOT_DIR" rev-parse main)"
WORKTREE_DIR="$(mktemp -d /tmp/pascal-release-XXXXXX)"

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
cp "$ASC_PRIVATE_KEY_PATH" "$WORKTREE_DIR/apps/native/$(basename "$ASC_PRIVATE_KEY_PATH")"

if [[ -d "$ROOT_DIR/node_modules" && ! -e "$WORKTREE_DIR/node_modules" ]]; then
  ln -s "$ROOT_DIR/node_modules" "$WORKTREE_DIR/node_modules"
fi
if [[ -d "$ROOT_DIR/apps/native/node_modules" && ! -e "$WORKTREE_DIR/apps/native/node_modules" ]]; then
  ln -s "$ROOT_DIR/apps/native/node_modules" "$WORKTREE_DIR/apps/native/node_modules"
fi

echo "Starting EAS iOS production build with auto-submit..."
pushd "$WORKTREE_DIR/apps/native" >/dev/null
set -a
source "$WORKTREE_DIR/.env.local"
set +a

BUILD_OUTPUT="$(eas build --platform ios --profile production --auto-submit --non-interactive --no-wait --json 2>&1)"
echo "$BUILD_OUTPUT"

BUILD_ID="$(printf '%s\n' "$BUILD_OUTPUT" | rg -o 'builds/[0-9a-f-]{36}' | head -n1 | cut -d/ -f2 || true)"
if [[ -z "$BUILD_ID" ]]; then
  echo "Could not parse EAS build ID from output." >&2
  exit 1
fi
popd >/dev/null

echo "Build started: $BUILD_ID"

BUILD_STATUS=""
BUILD_NUMBER=""
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
print(obj.get("appBuildVersion", ""))
print(obj.get("gitCommitHash", ""))
PY
)"
  BUILD_STATUS="$(printf '%s\n' "$META" | sed -n '1p')"
  BUILD_NUMBER="$(printf '%s\n' "$META" | sed -n '2p')"
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

if [[ -z "$BUILD_NUMBER" ]]; then
  echo "Build completed but build number was not found." >&2
  exit 1
fi

echo "Build finished. Build number: $BUILD_NUMBER"

VERSION_JSON="$(asc versions list --app "$ASC_APP_ID" --version "$VERSION" --platform IOS --pretty)"
VERSION_ID="$(python3 - "$VERSION_JSON" <<'PY'
import json, sys
obj = json.loads(sys.argv[1])
data = obj.get("data", [])
print(data[0]["id"] if data else "")
PY
)"
if [[ -z "$VERSION_ID" ]]; then
  echo "Could not find App Store version ID for version $VERSION." >&2
  exit 1
fi

echo "Polling App Store Connect for build number $BUILD_NUMBER..."
ASC_BUILD_ID=""
ASC_BUILD_STATE=""
for ((i = 1; i <= MAX_POLLS; i++)); do
  BUILD_JSON="$(asc builds list --app "$ASC_APP_ID" --version "$VERSION" --build-number "$BUILD_NUMBER" --pretty)"
  PARSED="$(python3 - "$BUILD_JSON" <<'PY'
import json, sys
obj = json.loads(sys.argv[1])
data = obj.get("data", [])
if not data:
    print("\n")
    raise SystemExit(0)
item = data[0]
print(item.get("id", ""))
print(item.get("attributes", {}).get("processingState", ""))
PY
)"
  ASC_BUILD_ID="$(printf '%s\n' "$PARSED" | sed -n '1p')"
  ASC_BUILD_STATE="$(printf '%s\n' "$PARSED" | sed -n '2p')"

  if [[ -n "$ASC_BUILD_ID" && "$ASC_BUILD_STATE" == "VALID" ]]; then
    break
  fi
  echo "[$i/$MAX_POLLS] ASC build visibility/state: ${ASC_BUILD_STATE:-missing} (waiting ${POLL_SECONDS}s)"
  sleep "$POLL_SECONDS"
done

if [[ -z "$ASC_BUILD_ID" || "$ASC_BUILD_STATE" != "VALID" ]]; then
  echo "Build $BUILD_NUMBER did not become VALID in ASC within timeout." >&2
  exit 1
fi

echo "Attaching build $ASC_BUILD_ID to version $VERSION_ID..."
asc versions attach-build --version-id "$VERSION_ID" --build "$ASC_BUILD_ID" --output table

echo "Running final validation..."
set +e
VALIDATE_OUTPUT="$(asc validate --app "$ASC_APP_ID" --version-id "$VERSION_ID" --platform IOS --output table 2>&1)"
VALIDATE_EXIT=$?
set -e
echo "$VALIDATE_OUTPUT"

echo
echo "Release Automation Summary"
echo "  EAS build id:        $BUILD_ID"
echo "  Build number:        $BUILD_NUMBER"
echo "  Build commit:        ${BUILD_COMMIT:-unknown}"
echo "  ASC build id:        $ASC_BUILD_ID"
echo "  ASC version id:      $VERSION_ID"
echo "  EAS submissions page: https://expo.dev/accounts/pascalorg/projects/pascal/submissions"

if [[ "$VALIDATE_EXIT" -ne 0 ]]; then
  if printf '%s' "$VALIDATE_OUTPUT" | rg -q 'availability\.missing'; then
    echo
    echo "Remaining blocker: Pricing and Availability."
    echo "Set it manually in App Store Connect: App > Pricing and Availability."
    exit 2
  fi
  echo
  echo "Validation still has blocking issues. Review output above."
  exit "$VALIDATE_EXIT"
fi

echo
echo "Validation passed. You can submit this version for review."
