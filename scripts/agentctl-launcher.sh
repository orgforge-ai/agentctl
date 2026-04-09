#!/usr/bin/env bash
set -euo pipefail

SOURCE_PATH="${BASH_SOURCE[0]}"
while [ -L "$SOURCE_PATH" ]; do
  SOURCE_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
  SOURCE_PATH="$(readlink "$SOURCE_PATH")"
  case "$SOURCE_PATH" in
    /*) ;;
    *) SOURCE_PATH="$SOURCE_DIR/$SOURCE_PATH" ;;
  esac
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$SOURCE_PATH")" && pwd)"
LIB_PATH="$SCRIPT_DIR/../lib/agentctl.cjs"

if ! command -v node >/dev/null 2>&1; then
  echo "agentctl requires Node 20+ and could not find 'node' on PATH." >&2
  exit 1
fi

exec node "$LIB_PATH" "$@"
