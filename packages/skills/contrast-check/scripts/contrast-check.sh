#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 2 ]; then
  echo "Usage: bash contrast-check.sh <color1> <color2> [color3] ..." >&2
  exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "Installing dependencies..." >&2
  (cd "$SCRIPT_DIR" && npm install --no-audit --no-fund --silent) >&2
fi

node "$SCRIPT_DIR/contrast-check.js" "$@"
