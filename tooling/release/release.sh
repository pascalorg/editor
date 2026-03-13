#!/usr/bin/env bash
set -euo pipefail

# Unified Release Script — builds and submits to both App Store and Play Store
# Usage: bash tooling/release/release.sh [version] [platform]
#   version:  App Store version string (e.g. "1.0") — required for iOS
#   platform: "all" (default), "ios", "android"
#
# Examples:
#   bash tooling/release/release.sh 1.0          # Both platforms
#   bash tooling/release/release.sh 1.0 ios      # iOS only
#   bash tooling/release/release.sh "" android    # Android only (no ASC version needed)
#   bun native:release 1.0                        # Via package.json script

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

VERSION="${1:-}"
PLATFORM="${2:-all}"

if [[ "$PLATFORM" == "all" || "$PLATFORM" == "ios" ]]; then
  if [[ -z "$VERSION" ]]; then
    echo "Error: App Store version is required for iOS release." >&2
    echo "Usage: $0 <version> [platform]" >&2
    echo "  e.g.: $0 1.0" >&2
    exit 1
  fi
fi

IOS_PID=""
ANDROID_PID=""
IOS_EXIT=0
ANDROID_EXIT=0

if [[ "$PLATFORM" == "all" || "$PLATFORM" == "ios" ]]; then
  echo "=== Starting iOS release (version $VERSION) ==="
  bash "$ROOT_DIR/tooling/release/ios-appstore-release.sh" "$VERSION" &
  IOS_PID=$!
fi

if [[ "$PLATFORM" == "all" || "$PLATFORM" == "android" ]]; then
  echo "=== Starting Android release (internal track) ==="
  bash "$ROOT_DIR/tooling/release/android-playstore-release.sh" internal &
  ANDROID_PID=$!
fi

# Wait for both to finish
if [[ -n "$IOS_PID" ]]; then
  wait "$IOS_PID" || IOS_EXIT=$?
fi

if [[ -n "$ANDROID_PID" ]]; then
  wait "$ANDROID_PID" || ANDROID_EXIT=$?
fi

echo
echo "========================================="
echo "  Release Summary"
echo "========================================="

if [[ -n "$IOS_PID" ]]; then
  if [[ "$IOS_EXIT" -eq 0 ]]; then
    echo "  iOS:     SUCCESS"
  elif [[ "$IOS_EXIT" -eq 2 ]]; then
    echo "  iOS:     NEEDS MANUAL STEP (pricing/availability)"
  else
    echo "  iOS:     FAILED (exit $IOS_EXIT)"
  fi
fi

if [[ -n "$ANDROID_PID" ]]; then
  if [[ "$ANDROID_EXIT" -eq 0 ]]; then
    echo "  Android: SUCCESS"
  else
    echo "  Android: FAILED (exit $ANDROID_EXIT)"
  fi
fi

echo "========================================="

# Exit with failure if either platform failed
if [[ "$IOS_EXIT" -ne 0 && "$IOS_EXIT" -ne 2 ]] || [[ "$ANDROID_EXIT" -ne 0 ]]; then
  exit 1
fi
