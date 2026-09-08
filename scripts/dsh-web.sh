#!/usr/bin/env bash
set -euo pipefail

# Find the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Search for resources/runtime and resources/config
if [ -d "$SCRIPT_DIR/resources/runtime" ]; then
  RUNTIME_BIN="$SCRIPT_DIR/resources/runtime/deepseek-harness-sdk-runtime-linux-arm64"
  PATCH_FILE="$SCRIPT_DIR/resources/config/intranet.cordis.patch.yml"
elif [ -d "$SCRIPT_DIR/runtime" ]; then
  RUNTIME_BIN="$SCRIPT_DIR/runtime/deepseek-harness-sdk-runtime-linux-arm64"
  PATCH_FILE="$SCRIPT_DIR/config/intranet.cordis.patch.yml"
else
  echo "dsh-web: cannot locate deepseek-harness runtime resources." >&2
  exit 1
fi

echo "[dsh-web] Starting DeepSeek Harness Web runtime on ARM64 Linux..."
exec "$RUNTIME_BIN" --profile web --patch "$PATCH_FILE" "$@"
