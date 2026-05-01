#!/usr/bin/env bash
# Workday Studio MCP — local install (already cloned)
#
# Usage (from inside the cloned repo):
#   ./bin/install.sh
#
# Same as quickstart.sh but for users who already have the repo cloned and just
# want to install dependencies + get the registration command.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${GREEN}==>${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}!!${RESET} %s\n" "$*"; }
error() { printf "${RED}xx${RESET} %s\n" "$*" >&2; }

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# --- prereqs -----------------------------------------------------------------

info "Checking prerequisites..."

if ! command -v node >/dev/null 2>&1; then
  error "node is not installed. Install Node.js 18+ from https://nodejs.org and re-run."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node $NODE_MAJOR is too old. Please install Node.js 18 or higher."
  exit 1
fi

NODE_PATH=$(command -v node)
info "Found node $(node --version) at $NODE_PATH"

# --- npm install -------------------------------------------------------------

info "Installing npm dependencies..."
cd "$REPO_DIR"
npm install --silent

# --- config ------------------------------------------------------------------

if [ ! -f "$REPO_DIR/config.json" ]; then
  if [ -f "$REPO_DIR/config.json.example" ]; then
    cp "$REPO_DIR/config.json.example" "$REPO_DIR/config.json"
    warn "Created config.json from example — edit workspace_path before running."
  fi
else
  info "config.json already exists — leaving it alone."
fi

# --- next steps --------------------------------------------------------------

cat <<EOF

${BOLD}Setup complete.${RESET}

Register with Claude Code:

   claude mcp add studio-mcp $NODE_PATH $REPO_DIR/src/index.mjs

Or add to Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json):

   {
     "mcpServers": {
       "studio-mcp": {
         "command": "$NODE_PATH",
         "args": ["$REPO_DIR/src/index.mjs"]
       }
     }
   }

EOF
