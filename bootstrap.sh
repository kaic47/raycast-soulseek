#!/usr/bin/env bash
# Soulseek Raycast Extension — one-command installer for friends
# Usage: curl -sL https://raw.githubusercontent.com/kaic47/raycast-soulseek/main/bootstrap.sh | bash

set -euo pipefail

REPO="https://github.com/kaic47/raycast-soulseek.git"
DEST="$HOME/raycast-extensions/soulseek"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "${RED}✗${NC} $*"; }
step() { echo -e "\n${YELLOW}→${NC} $*"; }

echo ""
echo "════════════════════════════════════════"
echo "  Soulseek for Raycast — Setup"
echo "════════════════════════════════════════"
echo ""

# ── 1. Raycast ────────────────────────────────────────────────────────────────
step "Checking for Raycast…"
if [ ! -d "/Applications/Raycast.app" ]; then
  err "Raycast is not installed."
  echo ""
  echo "Opening raycast.com — install Raycast first, then re-run this script."
  open "https://raycast.com"
  exit 1
fi
ok "Raycast found"

# ── 2. Homebrew ───────────────────────────────────────────────────────────────
step "Checking for Homebrew…"
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found — installing it now. You may be asked for your password."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for this session
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -f "/usr/local/bin/brew" ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
ok "Homebrew ready"

# ── 3. Node.js ────────────────────────────────────────────────────────────────
step "Checking for Node.js…"
if ! command -v node &>/dev/null; then
  warn "Node.js not found — installing via Homebrew…"
  brew install node
fi
ok "Node.js $(node --version) ready"

# ── 4. Git ────────────────────────────────────────────────────────────────────
step "Checking for Git…"
if ! command -v git &>/dev/null; then
  warn "Git not found — installing via Homebrew…"
  brew install git
fi
ok "Git ready"

# ── 5. Clone or update extension ──────────────────────────────────────────────
step "Setting up extension…"
if [ -d "$DEST/.git" ]; then
  warn "Extension already exists — pulling latest updates…"
  git -C "$DEST" pull --ff-only --quiet
  ok "Updated"
else
  mkdir -p "$(dirname "$DEST")"
  git clone --quiet "$REPO" "$DEST"
  ok "Cloned to $DEST"
fi

# ── 6. Placeholder icon (Python 3 — always available on macOS) ────────────────
step "Generating extension icon…"
ICON="$DEST/assets/extension-icon.png"
if [ ! -f "$ICON" ]; then
  python3 - "$ICON" <<'PYEOF'
import sys, struct, zlib

def make_png(path, w, h, r, g, b):
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes([r, g, b] * w) for _ in range(h))
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw)))
        f.write(chunk(b'IEND', b''))

make_png(sys.argv[1], 512, 512, 74, 47, 159)  # purple-ish
PYEOF
  ok "Icon generated"
else
  ok "Icon already exists"
fi

# ── 7. Install npm dependencies ───────────────────────────────────────────────
step "Installing extension dependencies…"
cd "$DEST"
npm install --silent --no-fund --no-audit
ok "Dependencies installed"

# ── 8. Launch in Raycast dev mode ─────────────────────────────────────────────
step "Starting extension in Raycast…"

# Kill any existing dev session for this extension
pkill -f "ray develop" 2>/dev/null || true

# Start in background; output goes to a log file
npm run dev > "$DEST/.dev.log" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$DEST/.dev.pid"

echo "   Waiting for Raycast to pick up the extension…"
sleep 5

# Open the Setup command in Raycast
open "raycast://extensions/chmura/soulseek/setup" 2>/dev/null || true

echo ""
echo "════════════════════════════════════════"
ok "Done! Raycast should now show the Soulseek Setup screen."
echo ""
echo "   If it doesn't appear automatically:"
echo "   → Open Raycast (⌘Space)"
echo "   → Type: Setup Soulseek"
echo "   → Press Enter"
echo ""
echo "   The extension keeps running in the background (PID $DEV_PID)."
echo "   Log: $DEST/.dev.log"
echo "════════════════════════════════════════"
echo ""
