#!/bin/bash
# play-lionn.sh — start the game on http://localhost:5180/ with no Claude session needed.
#
# What this does:
#   1. If the production build is missing or older than the source, rebuild it.
#   2. Serve the static build (dist/) on port 5180 with python3's http.server.
#   3. Open the browser at the game URL.
#
# Stop the server with Ctrl+C in the terminal that ran this script.
#
# Usage:
#   cd /Users/alextavassoli/2026_Claude_Code_Enliven/lionn-night-prowler
#   ./play-lionn.sh
#
# Or double-click it in Finder once you `chmod +x play-lionn.sh` (already done).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$SCRIPT_DIR/game"
DIST_DIR="$GAME_DIR/dist"
PORT=5180
URL="http://localhost:$PORT/"

cd "$GAME_DIR"

# ─── 1. Build if needed ─────────────────────────────────────────────
need_build=0
if [[ ! -d "$DIST_DIR" || ! -f "$DIST_DIR/index.html" ]]; then
  need_build=1
elif [[ -n "$(find src -newer "$DIST_DIR/index.html" -print -quit 2>/dev/null)" ]]; then
  need_build=1
elif [[ -n "$(find public -newer "$DIST_DIR/index.html" -print -quit 2>/dev/null)" ]]; then
  need_build=1
fi

if [[ "$need_build" == "1" ]]; then
  echo "[play-lionn] Building production bundle..."
  if ! command -v npm >/dev/null 2>&1; then
    export PATH="/opt/homebrew/bin:$PATH"
  fi
  npm run build
  echo
fi

# ─── 2. Free the port if a stale server is hogging it ────────────────
if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "[play-lionn] Port $PORT is in use — killing stale process(es)..."
  lsof -ti:$PORT | xargs -r kill 2>/dev/null || true
  sleep 0.5
fi

# ─── 3. Open browser shortly after server starts ─────────────────────
( sleep 1 && open "$URL" ) &

# ─── 4. Serve dist/ ──────────────────────────────────────────────────
echo "[play-lionn] Serving $DIST_DIR on $URL"
echo "[play-lionn] Press Ctrl+C to stop."
echo
cd "$DIST_DIR"
exec python3 -m http.server "$PORT"
