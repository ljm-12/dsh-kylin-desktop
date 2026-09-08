#!/usr/bin/env bash
set -euo pipefail

# Find the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Search for base resources directory
if [ -d "$SCRIPT_DIR/resources/runtime" ]; then
  BASE_DIR="$SCRIPT_DIR/resources"
elif [ -d "$SCRIPT_DIR/runtime" ]; then
  BASE_DIR="$SCRIPT_DIR"
elif [ -d "/opt/DeepSeek Harness Kylin/resources/runtime" ]; then
  BASE_DIR="/opt/DeepSeek Harness Kylin/resources"
else
  echo "dsh-web: cannot locate deepseek-harness runtime resources." >&2
  exit 1
fi

RUNTIME_BIN="$BASE_DIR/runtime/deepseek-harness-sdk-runtime-linux-arm64"
PATCH_FILE="$BASE_DIR/config/intranet.cordis.patch.yml"

export DSH_HOME="${DSH_HOME:-$HOME/.config/dsh-kylin-desktop-packaging/runtime-home}"
mkdir -p "$DSH_HOME" "$HOME/AgentWorkspace"

if [ -d "$BASE_DIR/skills" ]; then
  export DSH_BUNDLED_SKILL_DIR="$BASE_DIR/skills"
fi

if [ -d "$BASE_DIR/office" ]; then
  export PATH="$BASE_DIR/office:$PATH"
fi

cd "$HOME/AgentWorkspace"

echo "[dsh-web] Starting DeepSeek Harness Web runtime on ARM64 Linux..."
echo "[dsh-web] Workspace: $HOME/AgentWorkspace"
echo "[dsh-web] DSH_HOME:  $DSH_HOME"
exec "$RUNTIME_BIN" --profile web --patch "$PATCH_FILE" "$@"
