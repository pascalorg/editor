#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: bash image-compare.sh <image1> <image2> [diff-output.png] [threshold]" >&2
  exit 1
fi

for img in "$1" "$2"; do
  if [ ! -f "$img" ]; then
    echo "Error: File not found: $img" >&2
    exit 1
  fi
done

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing dependencies..." >&2
  (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund --silent) >&2
fi

node "$SCRIPT_DIR/image-compare.js" "$@"
