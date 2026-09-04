#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_PATH="$1"

if [ -z "$IMAGE_PATH" ]; then
  echo "Usage: bash image-to-text.sh <image-path> [language]" >&2
  exit 1
fi

if [ ! -f "$IMAGE_PATH" ]; then
  echo "Error: File not found: $IMAGE_PATH" >&2
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing dependencies..." >&2
  (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund --silent) >&2
fi

node "$SCRIPT_DIR/image-to-text.js" "$@"
