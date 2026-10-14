#!/usr/bin/env bash
set -euo pipefail
SOURCE="${1:?official source required}"
ELECTRON="${2:?Electron executable required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$(mktemp -d /tmp/dsh-transport-smoke.XXXXXX)"
trap 'rm -rf -- "$SCRATCH"' EXIT
export DSH_WEB_DOCUMENT="$SCRATCH/web-document.mjs"
export DSH_TRANSPORT_SCRATCH="$SCRATCH/user-data"
node --input-type=module - "$SOURCE/apps/desktop/src/web-document.ts" "$DSH_WEB_DOCUMENT" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
writeFileSync(process.argv[3], stripTypeScriptTypes(readFileSync(process.argv[2], 'utf8')))
JS
# Sandbox opt-out is restricted to this disposable Xvfb qualification process.
timeout 60s xvfb-run -a "$ELECTRON" --no-sandbox --disable-gpu "$ROOT/scripts/desktop-transport-smoke.mjs"
node -e 'const assert=require("node:assert/strict"), fs=require("node:fs"); const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); assert.equal(result.replies,40); assert.ok(result.ticks>=60)' "$DSH_TRANSPORT_SCRATCH/passed.json"
