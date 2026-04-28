#!/usr/bin/env bash
#
# claudeline installer — downloads the right Bun-compiled binary for
# this host from the latest GitHub release, drops it on $PATH, and runs
# `claudeline install` to wire it as the Claude Code statusLine.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/arcasilesgroup/claudeline/main/scripts/install.sh | bash
#
# Env vars (rare):
#   CLAUDELINE_VERSION   pin to a specific tag (e.g. "v0.3.3"); default = latest
#   CLAUDELINE_PREFIX    install prefix (default $HOME/.local/bin)
#   CLAUDELINE_NO_WIRE   set to "1" to skip the `claudeline install` step
#
# Exit codes:
#   0 success / 1 generic failure / 2 unsupported platform
#
# This script never runs untrusted shell. Binaries are SHA256-checked
# against the .sha256 sidecar published alongside each release asset.

set -euo pipefail

REPO="arcasilesgroup/claudeline"
PREFIX="${CLAUDELINE_PREFIX:-$HOME/.local/bin}"
TAG="${CLAUDELINE_VERSION:-}"

err() {
  echo "claudeline-install: error: $*" >&2
}

info() {
  echo "claudeline-install: $*"
}

require() {
  command -v "$1" >/dev/null 2>&1 || {
    err "missing required command: $1"
    exit 1
  }
}

require curl
require uname
require mktemp
# `shasum` is BSD-default on macOS; `sha256sum` is Linux-default. Use
# whichever is available so we don't pull in extra deps on either OS.
SHA_CMD=""
if command -v sha256sum >/dev/null 2>&1; then SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then SHA_CMD="shasum -a 256"
else
  err "need sha256sum or shasum to verify the download"
  exit 1
fi

detect_target() {
  local os arch
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  arch=$(uname -m)
  case "$os" in
    darwin)
      case "$arch" in
        arm64|aarch64) echo "claudeline-darwin-arm64" ;;
        x86_64) echo "claudeline-darwin-x64" ;;
        *) echo "" ;;
      esac
      ;;
    linux)
      case "$arch" in
        x86_64) echo "claudeline-linux-x64" ;;
        aarch64|arm64) echo "claudeline-linux-arm64" ;;
        *) echo "" ;;
      esac
      ;;
    *)
      # Windows users should use the .exe binary directly or `npm i -g`.
      # PowerShell users have a separate install path documented in README.
      echo ""
      ;;
  esac
}

ASSET="$(detect_target)"
if [ -z "$ASSET" ]; then
  err "unsupported platform: $(uname -s) $(uname -m). See README for npm/Homebrew install."
  exit 2
fi

# Resolve tag if not pinned. The releases API returns the latest
# published release at /releases/latest. We avoid `jq` to keep the
# script dependency-free; a single grep + sed pulls the tag_name.
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m 1 '"tag_name"' \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')
  if [ -z "$TAG" ]; then
    err "could not resolve latest tag from GitHub API"
    exit 1
  fi
fi

info "installing claudeline $TAG ($ASSET) to $PREFIX"

# Stage download in a temp dir so a partial fetch / failed checksum
# never leaves a half-binary on $PATH.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

BIN_URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
SHA_URL="$BIN_URL.sha256"

curl -fsSL --retry 3 --retry-delay 1 -o "$TMP/$ASSET" "$BIN_URL"
curl -fsSL --retry 3 --retry-delay 1 -o "$TMP/$ASSET.sha256" "$SHA_URL"

# The .sha256 file is `<hash>  <filename>`. Verify with the matching
# tool and a strict check (no auto-skip, exit non-zero on mismatch).
( cd "$TMP" && $SHA_CMD --check --status "$ASSET.sha256" )
info "checksum OK"

mkdir -p "$PREFIX"
install -m 0755 "$TMP/$ASSET" "$PREFIX/claudeline"

# Probe whether the new binary is on PATH already. If not, print a one-
# liner the user can paste into their shell rc — don't auto-edit dotfiles.
if ! command -v claudeline >/dev/null 2>&1 \
   || [ "$(command -v claudeline)" != "$PREFIX/claudeline" ]; then
  info "installed to $PREFIX/claudeline"
  info "add this to your shell rc to put it on PATH:"
  echo "  export PATH=\"$PREFIX:\$PATH\""
else
  info "installed to $PREFIX/claudeline (already on PATH)"
fi

# Wire as the Claude Code statusLine unless the caller said no.
if [ "${CLAUDELINE_NO_WIRE:-0}" = "1" ]; then
  info "skipped \`claudeline install\` per CLAUDELINE_NO_WIRE=1"
else
  info "wiring claudeline as the Claude Code statusLine"
  if ! "$PREFIX/claudeline" install; then
    err "\`claudeline install\` failed; you can re-run it manually"
    # Don't fail the install — the binary is already on disk.
  fi
fi

info "done. Try \`claudeline doctor\` to verify the install."
