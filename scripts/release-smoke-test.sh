#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/artifacts}"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT
SMOKE_HOME="$TEST_ROOT/home"
SMOKE_PROJECT="$TEST_ROOT/project"

run_smoke_check() {
  local name="$1"
  shift

  local log_file="$TEST_ROOT/${name}.log"
  if ! "$@" >"$log_file" 2>&1; then
    echo "Smoke test failed during: $name" >&2
    cat "$log_file" >&2
    exit 1
  fi
}

bash scripts/build-release.sh

mkdir -p "$TEST_ROOT/install-root"
tar -xzf "$ARTIFACTS_DIR/agentctl-linux.tar.gz" -C "$TEST_ROOT"
cp -R "$TEST_ROOT/agentctl-linux/." "$TEST_ROOT/install-root/"
mkdir -p "$SMOKE_HOME" "$SMOKE_PROJECT"

run_smoke_check version \
  "$TEST_ROOT/install-root/bin/agentctl" --version
run_smoke_check doctor \
  bash -lc "cd '$SMOKE_PROJECT' && HOME='$SMOKE_HOME' '$TEST_ROOT/install-root/bin/agentctl' doctor"

echo "Release smoke test passed"
