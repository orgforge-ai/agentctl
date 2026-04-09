#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version)")"
RELEASE_ROOT="$ROOT_DIR/build/release"
PAYLOAD_DIR="$RELEASE_ROOT/agentctl-linux"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-$ROOT_DIR/artifacts}"

rm -rf "$RELEASE_ROOT"
mkdir -p "$PAYLOAD_DIR/bin" "$PAYLOAD_DIR/lib" "$ARTIFACTS_DIR"

npx esbuild src/cli/index.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --format=cjs \
  --outfile="$PAYLOAD_DIR/lib/agentctl.cjs"

cp scripts/agentctl-launcher.sh "$PAYLOAD_DIR/bin/agentctl"
chmod +x "$PAYLOAD_DIR/bin/agentctl"

cat > "$PAYLOAD_DIR/README.md" <<EOF
agentctl ${VERSION}

Install:
  ./bin/agentctl --version

This release requires Node 20 or newer on Linux.
EOF

tar -C "$RELEASE_ROOT" -czf "$ARTIFACTS_DIR/agentctl-linux.tar.gz" agentctl-linux

(
  cd "$ARTIFACTS_DIR"
  sha256sum agentctl-linux.tar.gz > sha256sums.txt
)

echo "Built release artifacts in $ARTIFACTS_DIR"
