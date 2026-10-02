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
[[ "$ACTUAL_VERSION" == "$VERSION" || "$ACTUAL_VERSION" == "${VERSION//-/\~}" ]]
dpkg-deb -x "$DEB" "$VERIFY"
APP="$VERIFY/opt/DeepSeek Harness Kylin"
test -f "$APP/resources/app.asar"
test -f "$APP/resources/runtime/primary-runtime/runtime.json"
test -f "$APP/resources/runtime/cli/bin/dsh"
test -f "$APP/resources/kylin-launcher.sh"
test -x "$APP/deepseek-harness-kylin.bin"
cmp "$ROOT/build/kylin-launcher.sh" "$APP/deepseek-harness-kylin"
cmp "$ROOT/config/proxy-root-ca.crt" "$APP/resources/config/proxy-root-ca.crt"
openssl x509 -in "$APP/resources/config/proxy-root-ca.crt" -noout -checkend 0
! grep -Eq -- '-----BEGIN .*PRIVATE KEY-----' "$APP/resources/config/proxy-root-ca.crt"
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
dpkg-deb -e "$DEB" "$VERIFY/control"
bash -n "$VERIFY/control/postinst" "$VERIFY/control/postrm"
(cd "$ROOT/dist" && sha256sum "$(basename "$DEB")" BUILD-INFO.json UPSTREAM-PATCH.diff RUNTIME-PATCH.diff > SHA256SUMS)
echo "Verified official Desktop ARM64 deb, $count ELF payloads, GLIBC <= 2.28, and proxy TLS trust."
