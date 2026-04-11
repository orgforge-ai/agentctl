#!/usr/bin/env bash
set -euo pipefail

REPO="${AGENTCTL_REPO:-orgforge-ai/agentcli}"
VERSION="${AGENTCTL_VERSION:-latest}"
INSTALL_BIN_DIR="${AGENTCTL_INSTALL_BIN_DIR:-$HOME/.local/bin}"
INSTALL_SHARE_DIR="${AGENTCTL_INSTALL_SHARE_DIR:-$HOME/.local/share/agentctl}"

tmpdir=""
cleanup() { [ -n "$tmpdir" ] && rm -rf "$tmpdir"; }
trap cleanup EXIT

fail() {
  echo "agentctl install: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

resolve_version() {
  if [ "$VERSION" != "latest" ]; then
    printf '%s\n' "$VERSION"
    return
  fi

  local url="https://api.github.com/repos/$REPO/releases/latest"
  local tag
  tag="$(curl -fsSL "$url" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ -n "$tag" ] || fail "could not resolve latest release from $url"
  printf '%s\n' "$tag"
}

check_platform() {
  [ "$(uname -s)" = "Linux" ] || fail "this installer supports Linux only"
}

check_node() {
  need_cmd node

  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  case "$major" in
    ''|*[!0-9]*)
      fail "could not parse Node version"
      ;;
  esac

  if [ "$major" -lt 20 ]; then
    fail "Node 20+ is required; found $(node --version)"
  fi
}

ensure_path_notice() {
  case ":$PATH:" in
    *":$INSTALL_BIN_DIR:"*)
      ;;
    *)
      echo
      echo "$INSTALL_BIN_DIR is not on PATH."
      echo "Add this to your shell profile:"
      echo "  export PATH=\"$INSTALL_BIN_DIR:\$PATH\""
      ;;
  esac
}

main() {
  check_platform
  need_cmd curl
  need_cmd tar
  need_cmd mktemp
  check_node

  local resolved_version
  resolved_version="$(resolve_version)"

  local artifact="agentctl-linux.tar.gz"
  local download_url="https://github.com/$REPO/releases/download/$resolved_version/$artifact"
  tmpdir="$(mktemp -d)"

  echo "Downloading $download_url"
  curl -fsSL "$download_url" -o "$tmpdir/$artifact"

  mkdir -p "$INSTALL_BIN_DIR" "$INSTALL_SHARE_DIR"
  tar -xzf "$tmpdir/$artifact" -C "$tmpdir"

  local version_dir="$INSTALL_SHARE_DIR/${resolved_version#v}"
  rm -rf "$version_dir"
  mkdir -p "$version_dir"
  cp -R "$tmpdir/agentctl-linux/." "$version_dir/"

  ln -sfn "$version_dir/bin/agentctl" "$INSTALL_BIN_DIR/agentctl"

  echo "Installed agentctl $resolved_version to $version_dir"
  echo "Linked $INSTALL_BIN_DIR/agentctl"
  ensure_path_notice
  echo
  "$INSTALL_BIN_DIR/agentctl" --version
}

main "$@"
