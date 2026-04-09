#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LIB_PATH="$SCRIPT_DIR/../lib/agentctl.cjs"

if ! command -v node >/dev/null 2>&1; then
  echo "agentctl requires Node 20+ and could not find 'node' on PATH." >&2
  exit 1
fi

exec node "$LIB_PATH" "$@"
