#!/usr/bin/env bash

set -eu

APP_NAME="spark"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="latest"
REPO="${SPARK_REPO:-tiagovicente2/spark}"
SPARK_SERVER="${SPARK_SERVER:-}"

print_usage() {
  cat <<EOF
Install spark from GitHub releases.

Usage:
  install.sh [--repo <owner/repo>] [--version <tag>] [--install-dir <path>] [--server <url>]

Options:
  --repo         GitHub repository in owner/repo format (default: tiagovicente2/spark)
  --version      Release tag (default: latest)
  --install-dir  Install directory (default: ~/.local/bin)
  --server       Default Spark backend server URL
  -h, --help     Show this help

Examples:
  install.sh
  install.sh --version v1.0.0
  install.sh --server https://spark.example.com
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed." >&2
    exit 1
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --repo)
      REPO="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="$2"
      shift 2
      ;;
    --server)
      SPARK_SERVER="$2"
      shift 2
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    *)
      echo "Error: unknown argument '$1'" >&2
      print_usage
      exit 1
      ;;
  esac
done

require_command curl
require_command uname

os_type="$(uname -s)"
case "$os_type" in
  Linux)
    asset_os="linux"
    ;;
  Darwin)
    asset_os="darwin"
    ;;
  *)
    echo "Error: unsupported OS '$os_type'. spark currently supports Linux and macOS (Darwin)." >&2
    exit 1
    ;;
esac

arch="$(uname -m)"
case "$arch" in
  x86_64)
    asset_arch="x64"
    ;;
  aarch64|arm64)
    asset_arch="arm64"
    ;;
  *)
    echo "Error: unsupported architecture '$arch'." >&2
    exit 1
    ;;
esac

asset_name="${APP_NAME}-${asset_os}-${asset_arch}"

if [ "$VERSION" = "latest" ]; then
  download_url="https://github.com/${REPO}/releases/latest/download/${asset_name}"
else
  download_url="https://github.com/${REPO}/releases/download/${VERSION}/${asset_name}"
fi

tmp_file="$(mktemp)"
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT INT TERM

echo "Downloading $APP_NAME from: $download_url"
curl -fsSL "$download_url" -o "$tmp_file"

mkdir -p "$INSTALL_DIR"
chmod +x "$tmp_file"
mv "$tmp_file" "$INSTALL_DIR/$APP_NAME"

echo "Installed: $INSTALL_DIR/$APP_NAME"

# Configure default server if specified
if [ -n "$SPARK_SERVER" ]; then
  echo "Configuring default Spark server URL to: $SPARK_SERVER"
  mkdir -p "$HOME/.spark"
  cat <<EOF > "$HOME/.spark/config.json"
{
  "server": "$SPARK_SERVER"
}
EOF
fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*)
    ;;
  *)
    echo ""
    echo "Add this directory to PATH to run '$APP_NAME' directly:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    ;;
esac

echo ""
echo "Run: $APP_NAME"
