#!/usr/bin/env bash
# Builds backend + frontend, stages a self-contained folder (portable
# Node.js runtime + compiled app + systemd unit + install/uninstall
# scripts), and tars it up as racktemp-linux-x64.tar.gz. Run on Linux
# (x86_64) — the "native" Prisma engine generated here must match the
# machine that later runs install.sh.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
LINUX_DIR="$ROOT/linux"
TOOLS="$ROOT/tools"
STAGE="$ROOT/dist-linux/racktemp-linux-x64"
OUT_DIR="$ROOT/dist-linux"

NODE_VERSION="20.18.1"
NODE_DIR_NAME="node-v${NODE_VERSION}-linux-x64"

echo "== 1/5: backend build =="
cd "$BACKEND"
npm ci
npx prisma generate
npm run build

echo "== 2/5: frontend build =="
cd "$FRONTEND"
npm ci
npm run build

echo "== 3/5: portable Node.js runtime =="
mkdir -p "$TOOLS"
NODE_TAR="$TOOLS/${NODE_DIR_NAME}.tar.xz"
NODE_DIR="$TOOLS/${NODE_DIR_NAME}"
if [ ! -d "$NODE_DIR" ]; then
  if [ ! -f "$NODE_TAR" ]; then
    echo "Downloading Node.js $NODE_VERSION..."
    curl -sL -o "$NODE_TAR" "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIR_NAME}.tar.xz"
  fi
  tar -xf "$NODE_TAR" -C "$TOOLS"
fi

echo "== 4/5: staging =="
rm -rf "$STAGE"
mkdir -p "$STAGE"

cp -r "$NODE_DIR" "$STAGE/node"

mkdir -p "$STAGE/backend"
cp -r "$BACKEND/dist" "$STAGE/backend/"
cp -r "$BACKEND/public" "$STAGE/backend/"
cp -r "$BACKEND/node_modules" "$STAGE/backend/"
cp -r "$BACKEND/prisma" "$STAGE/backend/"
cp "$BACKEND/package.json" "$STAGE/backend/package.json"

cp "$LINUX_DIR/racktemp.service" "$STAGE/"
cp "$LINUX_DIR/install.sh" "$STAGE/"
cp "$LINUX_DIR/uninstall.sh" "$STAGE/"
chmod +x "$STAGE/install.sh" "$STAGE/uninstall.sh"

echo "== 5/5: tar =="
mkdir -p "$OUT_DIR"
tar -czf "$OUT_DIR/racktemp-linux-x64.tar.gz" -C "$ROOT/dist-linux" racktemp-linux-x64

echo ""
echo "Done: $OUT_DIR/racktemp-linux-x64.tar.gz"
