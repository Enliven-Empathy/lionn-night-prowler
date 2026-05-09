#!/bin/bash
# deploy-gh-pages.sh — rebuild dist/ + push to GitHub Pages.
#
# Run this anytime you (or Claude) edit the game and want the public
# URL updated. Pages is live at:
#
#   https://alex-enliven.github.io/lionn-night-prowler/
#
# This script:
#   1. Rebuilds the production bundle (`npm run build` in game/)
#   2. Stages dist/ contents into .deploy-staging/ (gitignored)
#   3. Force-pushes that staging tree to the `gh-pages` branch on GitHub
#   4. GitHub Pages auto-rebuilds and the URL serves the new build in ~30s
#
# No source code changes are pushed by this script — only the built
# artifacts. Source goes to `main` via the normal `git push` flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$SCRIPT_DIR/game"
DIST_DIR="$GAME_DIR/dist"
STAGING_DIR="$SCRIPT_DIR/.deploy-staging"
REMOTE_URL="https://github.com/alex-enliven/lionn-night-prowler.git"

cd "$GAME_DIR"

if ! command -v npm >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:$PATH"
fi

echo "[deploy] Building production bundle..."
npm run build
echo

echo "[deploy] Staging dist/ at $STAGING_DIR..."
rm -rf "$STAGING_DIR"
cp -R "$DIST_DIR" "$STAGING_DIR"
cd "$STAGING_DIR"

# Standalone git repo just for the staged dist — fresh history each deploy.
git init -b deploy >/dev/null 2>&1
git add . >/dev/null
git -c "user.email=deploy@lionn-night-prowler" -c "user.name=Lionn Deploy" commit -m "deploy: $(date -u '+%Y-%m-%d %H:%M:%S')Z" >/dev/null

echo "[deploy] Pushing to gh-pages branch..."
git push "$REMOTE_URL" deploy:gh-pages --force

echo
echo "[deploy] Done. GitHub Pages will rebuild in ~30 seconds."
echo "[deploy] Live URL:  https://alex-enliven.github.io/lionn-night-prowler/"
