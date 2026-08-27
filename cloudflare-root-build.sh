#!/usr/bin/env bash
set -euo pipefail

APP_DIR="silk-os-v0.6"

echo "[silk] installing v0.7 app dependencies from ${APP_DIR}"
npm --prefix "${APP_DIR}" ci

echo "[silk] building v0.7 app"
npm --prefix "${APP_DIR}" run build

# Cloudflare's deploy command runs from the repository root. Point the root
# node_modules at the app dependencies so `npx wrangler` resolves the pinned
# Wrangler version already installed by the app instead of downloading another.
rm -rf node_modules
ln -s "${APP_DIR}/node_modules" node_modules

echo "[silk] root build handoff ready"
