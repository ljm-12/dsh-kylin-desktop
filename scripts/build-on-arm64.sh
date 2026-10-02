#!/usr/bin/env bash
set -euo pipefail
SOURCE_DIR="${1:?usage: build-on-arm64.sh <official-source> <dsh-v-tag>}"
SOURCE_REF="${2:?usage: build-on-arm64.sh <official-source> <dsh-v-tag>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"
[[ "$(uname -s)-$(uname -m)" == Linux-aarch64 ]] || { echo 'Native Linux ARM64 required.' >&2; exit 1; }
[[ "$SOURCE_REF" == dsh-v* ]] || exit 1
test "$(git -C "$SOURCE_DIR" describe --tags --exact-match)" = "$SOURCE_REF"
VERSION="$(cd "$SOURCE_DIR" && node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
test "dsh-v$VERSION" = "$SOURCE_REF"
export DSH_SOURCE_DIR="$SOURCE_DIR"
export DSH_DESKTOP_TARGET_PLATFORM=linux DSH_DESKTOP_TARGET_ARCH=arm64
export DSH_DESKTOP_APP_ID=ai.deepseek.harness.kylin
export CI=true
node "$ROOT/scripts/prepare-proxy-ca.mjs"
node "$ROOT/scripts/patch-official-desktop.mjs" "$SOURCE_DIR"
node "$ROOT/scripts/patch-upstream-proxy.mjs" "$SOURCE_DIR"
cd "$SOURCE_DIR"
corepack pnpm install --frozen-lockfile
corepack pnpm run build:official
TARGET="$SOURCE_DIR/apps/desktop/.desktop-build/targets/linux-arm64"
corepack pnpm run release:pack --family dsh --out "$TARGET/packed/dsh" --concurrency 4
corepack pnpm --dir apps/desktop-host pack --pack-destination "$TARGET/packed/dsh"
corepack pnpm run release:pack --family vendor --out "$TARGET/packed/vendor" --concurrency 4
mkdir -p "$TARGET/packed/landlock"
corepack pnpm --dir native/system run build:ts
corepack pnpm --dir native/system/packages/entry pack --pack-destination "$TARGET/packed/landlock"
corepack pnpm --dir apps/desktop run prepare:runtime
corepack pnpm --dir apps/desktop run prepare:packages
corepack pnpm --dir apps/desktop run prepare:dsh -- --defer-runtime-smoke

# Rebuild the actual packaged PTY, not a different workspace copy.
ADDON_DIR="$TARGET/dsh/node_modules/node-pty"
test -d "$ADDON_DIR"
NODE_GYP_CANDIDATES=("$SOURCE_DIR"/node_modules/.pnpm/node-gyp@*/node_modules/node-gyp/bin/node-gyp.js)
test "${#NODE_GYP_CANDIDATES[@]}" -eq 1
# Official runtime manifest preparation removes lifecycle scripts. Invoke the
# lockfile-pinned build tool directly rather than relying on npm install hooks.
node "${NODE_GYP_CANDIDATES[0]}" configure --directory "$ADDON_DIR"
test -f "$ADDON_DIR/build/Makefile"
mkdir -p "$HOME/.cache"
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$SOURCE_DIR:$SOURCE_DIR" -v "$HOME/.cache:$HOME/.cache:ro" \
  -w "$ADDON_DIR" quay.io/pypa/manylinux_2_28_aarch64 \
  bash -euxo pipefail -c 'rm -rf build/Release && make -C build -j2 BUILDTYPE=Release'
test -f "$ADDON_DIR/build/Release/pty.node"
while IFS= read -r -d '' manifest; do
  module="$(dirname "$manifest")"
  mkdir -p "$module/prebuilds/linux-arm64"
  cp "$ADDON_DIR/build/Release/pty.node" "$module/prebuilds/linux-arm64/pty.node"
done < <(find "$TARGET/dsh/node_modules" -path '*/node-pty/package.json' -print0)
# Retain only runtime prebuilds, not generated Makefiles/object files.
rm -rf -- "$ADDON_DIR/build"
node "$ROOT/scripts/patch-packaged-office.mjs" "$TARGET/dsh"

# Reseal with upstream's inventory after the native build, then run upstream smoke.
corepack pnpm exec tsx "$ROOT/scripts/verify-prepared-runtime.ts"
chmod 755 "$ROOT/build/"*.sh
corepack pnpm --dir apps/desktop exec electron-builder --linux --arm64 --dir \
  --config "$ROOT/scripts/kylin-builder.config.mjs" --publish never
APP="$ROOT/dist/linux-arm64-unpacked"
# Official packing first applies Electron fuses to the real executable. The
# launcher is added afterwards; both files then belong to the resulting deb.
mv "$APP/deepseek-harness-kylin" "$APP/deepseek-harness-kylin.bin"
install -m 755 "$ROOT/build/kylin-launcher.sh" "$APP/deepseek-harness-kylin"
corepack pnpm --dir apps/desktop exec electron-builder --linux deb --arm64 \
  --prepackaged "$APP" --config "$ROOT/scripts/kylin-builder.config.mjs" --publish never
node "$ROOT/scripts/build-info.mjs" "$SOURCE_DIR" "$ROOT" "$SOURCE_REF"
bash "$ROOT/scripts/verify-linux-artifacts.sh" "$VERSION"
