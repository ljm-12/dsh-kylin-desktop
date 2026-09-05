#!/usr/bin/env bash
set -euxo pipefail

VERSION="${1:?usage: verify-linux-artifacts.sh <version>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
DEB="$DIST/DeepSeek-Harness-Kylin-ARM64-${VERSION}.deb"
APPIMAGE="$DIST/DeepSeek-Harness-Kylin-ARM64-${VERSION}.AppImage"
VERIFY_ROOT="$(mktemp -d /tmp/dsh-kylin-desktop-verify.XXXXXX)"

cleanup() {
  case "$VERIFY_ROOT" in
    /tmp/dsh-kylin-desktop-verify.*) rm -rf -- "$VERIFY_ROOT" ;;
    *) echo "verify-linux-artifacts: refusing unsafe cleanup target $VERIFY_ROOT" >&2 ;;
  esac
}
trap cleanup EXIT

verify_arm64() {
  local target="$1"
  local machine
  machine="$(readelf -h "$target" 2>/dev/null | grep -i 'Machine:' || true)"
  echo "verify-linux-artifacts: readelf($target) Machine -> $machine"
  if echo "$machine" | grep -Eiq 'aarch64|arm'; then
    return 0
  fi
  local file_desc
  file_desc="$(file "$target" 2>&1 || true)"
  echo "verify-linux-artifacts: file($target) -> $file_desc"
  if echo "$file_desc" | grep -Eiq 'aarch64|arm64|arm aarch64|ld-linux-aarch64'; then
    return 0
  fi
  echo "verify-linux-artifacts: binary $target is not ARM64 / aarch64!" >&2
  return 1
}

test -f "$DEB"
test -f "$APPIMAGE"
PACKAGE_NAME="$(dpkg-deb --field "$DEB" Package)"
echo "verify-linux-artifacts: Package=$PACKAGE_NAME"
test "$PACKAGE_NAME" = "deepseek-harness-kylin"
DEB_VERSION="$(dpkg-deb --field "$DEB" Version)"
echo "verify-linux-artifacts: Version=$DEB_VERSION"
test "$DEB_VERSION" = "$VERSION" || test "$DEB_VERSION" = "${VERSION//-/\~}"
DEB_ARCH="$(dpkg-deb --field "$DEB" Architecture)"
echo "verify-linux-artifacts: Architecture=$DEB_ARCH"
test "$DEB_ARCH" = "arm64"
dpkg-deb --extract "$DEB" "$VERIFY_ROOT/root"

mapfile -t runtimes < <(find "$VERIFY_ROOT/root/opt" -type f -name 'deepseek-harness-sdk-runtime-linux-arm64')
test "${#runtimes[@]}" = "1"
RUNTIME="${runtimes[0]}"
RIPGREP="${RUNTIME}-rg"
PATCH="$(dirname "$(dirname "$RUNTIME")")/config/intranet.cordis.patch.yml"
test -x "$RUNTIME"
test -x "$RIPGREP"
test -f "$PATCH"
verify_arm64 "$RUNTIME"
verify_arm64 "$RIPGREP"
ELECTRON="$(find "$VERIFY_ROOT/root/opt" -type f -name 'deepseek-harness-kylin' | head -1)"
test -n "$ELECTRON"
test -x "$ELECTRON"
verify_arm64 "$ELECTRON"

OFFICE_PATH="$(find "$VERIFY_ROOT/root/opt" -type d -name 'office' | head -1)"
test -n "$OFFICE_PATH"
test ! -d "$OFFICE_PATH/downloads"
test -x "$OFFICE_PATH/dsh-office"
test -x "$OFFICE_PATH/dsh-browser"
test -x "$OFFICE_PATH/dsh-python"

PYTHON_BIN="$(find "$OFFICE_PATH/python/bin" -type f -name 'python3.*' 2>/dev/null | head -1 || true)"
test -n "$PYTHON_BIN"
test -x "$PYTHON_BIN"
verify_arm64 "$PYTHON_BIN"

PYPDF_DIR="$(find "$OFFICE_PATH/python/lib" -maxdepth 3 -type d -name 'pypdf' 2>/dev/null | head -1 || true)"
test -n "$PYPDF_DIR"
test -d "$PYPDF_DIR"

for executable in "$RUNTIME" "$RIPGREP" "$ELECTRON" "$PYTHON_BIN"; do
  maximum="$(readelf --version-info "$executable" 2>/dev/null | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' | sort -V | tail -1 || true)"
  echo "verify-linux-artifacts: $executable maximum GLIBC=${maximum:-static}"
  if [[ -n "$maximum" ]]; then
    dpkg --compare-versions "$maximum" le 2.28
  fi
done
grep -Fq 'provider: intranet-openai' "$PATCH"
grep -A1 -F -- '- id: llm-deepseek' "$PATCH" | grep -Fq 'disabled: true'
grep -A1 -F -- '- id: tool-web' "$PATCH" | grep -Fq 'disabled: true'
grep -A1 -F -- '- id: message-feedback' "$PATCH" | grep -Fq 'disabled: true'

SKILLS_PATH="$(find "$VERIFY_ROOT/root/opt" -type d -name 'skills' | head -1)"
test -n "$SKILLS_PATH"
test -f "$SKILLS_PATH/offline-office-documents/SKILL.md"
test -f "$SKILLS_PATH/browser-automation/SKILL.md"
REPLACES="$(dpkg-deb --field "$DEB" Replaces || true)"
echo "verify-linux-artifacts: Replaces=$REPLACES"
echo "$REPLACES" | grep -Fq 'dsh-intranet-agent'

dpkg-deb --control "$DEB" "$VERIFY_ROOT/control"
test -f "$VERIFY_ROOT/control/postrm"
test -f "$VERIFY_ROOT/control/postinst"

verify_arm64 "$APPIMAGE"

(cd "$DIST" && sha256sum "$(basename "$DEB")" "$(basename "$APPIMAGE")" >SHA256SUMS)
cp -- "$ROOT/runtime/BUILD-INFO.json" "$DIST/BUILD-INFO.json"

echo "package=deepseek-harness-kylin"
echo "version=$VERSION"
echo "architecture=arm64"
echo "runtime=official-tagged-single-exe"
echo "desktop=thin-electron-loopback-carrier"
echo "verification=complete"
