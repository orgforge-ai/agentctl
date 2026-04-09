#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/artifacts}"
TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEST_ROOT"' EXIT

bash scripts/build-release.sh

mkdir -p "$TEST_ROOT/install-root"
tar -xzf "$ARTIFACTS_DIR/agentctl-linux.tar.gz" -C "$TEST_ROOT"
cp -R "$TEST_ROOT/agentctl-linux/." "$TEST_ROOT/install-root/"

"$TEST_ROOT/install-root/bin/agentctl" --version >/dev/null
"$TEST_ROOT/install-root/bin/agentctl" doctor >/dev/null

echo "Release smoke test passed"
