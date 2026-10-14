#!/usr/bin/env bash
set -euo pipefail
export DSH_SOURCE_DIR="${1:?official source required}"
ELECTRON="${2:?Electron executable required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="$(mktemp -d /tmp/dsh-page-connection.XXXXXX)"
trap 'rm -rf -- "$SCRATCH"' EXIT
export DSH_TRANSPORT_SCRATCH="$SCRATCH"
export DSH_PACKAGED_APP="${3:-}"
# Disposable virtual display only; production sandbox behavior is unchanged.
timeout 240s xvfb-run -a "$ELECTRON" --no-sandbox --disable-gpu "$ROOT/scripts/desktop-connection-smoke.mjs"
node -e 'const assert=require("node:assert/strict"), fs=require("node:fs"); const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); assert.equal(result.servedOfficialClient,true); assert.ok(result.apiReplies>0)' "$SCRATCH/passed.json"
