#!/usr/bin/env bash
set -euo pipefail
VERSION="${1:?version required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEB="$ROOT/dist/DeepSeek-Harness-Kylin-ARM64-$VERSION.deb"
VERIFY="$(mktemp -d /tmp/dsh-kylin-verify.XXXXXX)"
trap 'rm -rf -- "$VERIFY"' EXIT
test "$(dpkg-deb -f "$DEB" Package)" = deepseek-harness-kylin
test "$(dpkg-deb -f "$DEB" Architecture)" = arm64
ACTUAL_VERSION="$(dpkg-deb -f "$DEB" Version)"
[[ "$ACTUAL_VERSION" == "$VERSION-$DSH_BUILD_REVISION" || "$ACTUAL_VERSION" == "${VERSION//-/\~}-$DSH_BUILD_REVISION" ]]
dpkg --compare-versions "$ACTUAL_VERSION" gt "${ACTUAL_VERSION%-$DSH_BUILD_REVISION}"
echo "Verified installable Debian revision: $ACTUAL_VERSION"
dpkg-deb -x "$DEB" "$VERIFY"
APP="$VERIFY/opt/DeepSeek Harness Kylin"
test -f "$APP/resources/app.asar"
test -f "$APP/resources/runtime/primary-runtime/runtime.json"
test -f "$APP/resources/runtime/cli/bin/dsh"
test -f "$APP/resources/kylin-launcher.sh"
test -x "$APP/deepseek-harness-kylin.bin"
PACKAGING_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
ELECTRON_RUN_AS_NODE=1 "$APP/deepseek-harness-kylin.bin" -e '
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const [app, commit, revision] = process.argv.slice(1);
assert.equal(process.versions.electron,"44.5.1","Electron tray fix was not packaged");
const manifest = JSON.parse(fs.readFileSync(path.join(app,"resources/app.asar/package.json"),"utf8"));
assert.equal(manifest.kylinBuild.packagingCommit, commit);
assert.equal(manifest.kylinBuild.revision, revision);
assert.equal(manifest.version,"0.2.0-rc.2");
assert.equal(manifest.main,"lib/main.js");
assert.equal(fs.existsSync(path.join(app,"resources/transport-diagnostics.cjs")),false,"temporary transport observer was packaged");
assert.equal(fs.existsSync(path.join(app,"resources/app.asar/lib/kylin-main.mjs")),false,"temporary desktop entrypoint was packaged");
assert.deepEqual(fs.readFileSync(path.join(app,"resources/app.asar/lib/main.js")),
  fs.readFileSync(path.join(process.env.DSH_SOURCE_DIR,"apps/desktop/lib/main.js")),"official desktop main changed");
const client = fs.readFileSync(path.join(app,"resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/client.js"),"utf8");
assert.doesNotMatch(client,/generation source failed:|stableGenerationMs/);
for (const [name, sourcePath] of [["dsh-client-connection","packages/client/connection"], ["dsh-api-gateway","packages/api/gateway"]]) {
  const packaged=fs.readFileSync(path.join(app,"resources/app.asar/dsh/node_modules/@deepseek-ai",name,"lib/client.js"));
  const official=fs.readFileSync(path.join(process.env.DSH_SOURCE_DIR,sourcePath,"lib/client.js"));
  assert.deepEqual(packaged,official,"packaged runtime differs from official compilation: "+name);
}
console.log("Verified packaged build identity and official Connection/Gateway bytes:",commit,revision);
' "$APP" "$PACKAGING_COMMIT" "$DSH_BUILD_REVISION"
cmp "$ROOT/build/kylin-launcher.sh" "$APP/deepseek-harness-kylin"
ELECTRON_RUN_AS_NODE=1 "$APP/deepseek-harness-kylin.bin" \
  "$ROOT/scripts/websocket-compatibility-smoke.cjs" "$APP/resources/app.asar/dsh/node_modules/ws"
cmp "$ROOT/config/proxy-root-ca.crt" "$APP/resources/config/proxy-root-ca.crt"
node --input-type=module - "$ROOT" "$APP/resources/config/proxy-root-ca.crt" <<'JS'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { validateProxyCaBundle } = await import(pathToFileURL(`${process.argv[2]}/scripts/prepare-proxy-ca.mjs`))
console.log('Verified all packaged public CAs:', validateProxyCaBundle(readFileSync(process.argv[3], 'utf8')).length)
JS
count=0
while IFS= read -r -d '' executable; do
  file "$executable" | grep -q ELF || continue
  readelf -h "$executable" | grep -q AArch64
  maximum="$(readelf --version-info "$executable" 2>/dev/null | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' | sort -V | tail -1)"
  if [[ -n "$maximum" ]]; then
    dpkg --compare-versions "$maximum" le 2.28 || { echo "Incompatible GLIBC_$maximum: $executable" >&2; exit 1; }
  fi
  count=$((count + 1))
done < <(find "$APP" -type f -print0)
test "$count" -gt 4
# Verify real Electron Node-mode TLS trust rather than merely inspecting env names.
DSH_TEST_NODE="$APP/deepseek-harness-kylin.bin" ELECTRON_RUN_AS_NODE=1 \
  node --test "$ROOT/tests/certificate-trust.test.mjs"
(cd "$DSH_SOURCE_DIR" && corepack pnpm exec tsx "$ROOT/scripts/verify-prepared-runtime.ts" "$APP")
bash "$ROOT/scripts/verify-desktop-connection.sh" "$DSH_SOURCE_DIR" \
  "$DSH_SOURCE_DIR/apps/desktop/.desktop-build/targets/linux-arm64/electron/electron" "$APP"
timeout 180s dbus-run-session -- xvfb-run -a node "$ROOT/scripts/packaged-launcher-smoke.mjs" "$APP"
dpkg-deb -e "$DEB" "$VERIFY/control"
bash -n "$VERIFY/control/postinst" "$VERIFY/control/postrm"
(cd "$ROOT/dist" && sha256sum "$(basename "$DEB")" BUILD-INFO.json UPSTREAM-PATCH.diff RUNTIME-PATCH.diff > SHA256SUMS)
echo "Verified official Desktop ARM64 deb, $count ELF payloads, GLIBC <= 2.28, and proxy TLS trust."
