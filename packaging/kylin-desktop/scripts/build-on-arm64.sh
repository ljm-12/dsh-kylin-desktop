#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:?usage: build-on-arm64.sh <official-source-dir> <dsh-v-tag>}"
SOURCE_REF="${2:?usage: build-on-arm64.sh <official-source-dir> <dsh-v-tag>}"
PACKAGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$(cd "$SOURCE_DIR" && pwd)"

case "$(uname -m)" in
  aarch64|arm64) ;;
  *) echo "build-on-arm64: native Linux ARM64 is required; host is $(uname -s)-$(uname -m)." >&2; exit 1 ;;
esac
case "$SOURCE_REF" in
  dsh-v*) ;;
  *) echo "build-on-arm64: source ref must be an exact dsh-v* tag." >&2; exit 1 ;;
esac

for command_name in git node corepack docker file readelf dpkg-deb sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "build-on-arm64: $command_name is required." >&2
    exit 1
  }
done

test "$(git -C "$SOURCE_DIR" describe --tags --exact-match)" = "$SOURCE_REF"
VERSION="$(cd "$SOURCE_DIR" && node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
test "dsh-v$VERSION" = "$SOURCE_REF"
SOURCE_COMMIT="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
PNPM_VERSION="$(cd "$SOURCE_DIR" && node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).packageManager.split('@').at(-1)")"
test "$(cd "$SOURCE_DIR" && corepack pnpm --version)" = "$PNPM_VERSION"

(cd "$SOURCE_DIR" && corepack pnpm install --frozen-lockfile)

ADDON_DIR="$(cd "$SOURCE_DIR" && realpath packages/subprocess/subprocess-local/node_modules/node-pty)"
(cd "$SOURCE_DIR" && npm_config_build_from_source=true corepack pnpm --dir "$ADDON_DIR" run install)
ADDON="$ADDON_DIR/build/Release/pty.node"
test -f "$ADDON_DIR/build/Makefile"

PNPM_MOUNT=()
if [[ -n "${PNPM_HOME:-}" ]]; then
  PNPM_SETUP_ROOT="$(realpath "$(dirname "$(dirname "$PNPM_HOME")")")"
  PNPM_MOUNT=(-v "$PNPM_SETUP_ROOT:$PNPM_SETUP_ROOT:ro")
fi

mkdir -p "$HOME/.cache"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$SOURCE_DIR:$SOURCE_DIR" \
  -v "$HOME/.cache:$HOME/.cache:ro" \
  "${PNPM_MOUNT[@]}" \
  -w "$ADDON_DIR" \
  quay.io/pypa/manylinux_2_28_aarch64 \
  bash -euxo pipefail -c \
    'rm -rf build/Release && make -C build -j2 BUILDTYPE=Release'

test -f "$ADDON"
MAXIMUM_GLIBC="$(readelf --version-info "$ADDON" | sed -n 's/.*Name: GLIBC_\([0-9.]*\).*/\1/p' | sort -V | tail -1)"
test -n "$MAXIMUM_GLIBC"
dpkg --compare-versions "$MAXIMUM_GLIBC" le 2.28

(cd "$SOURCE_DIR" && DSH_BUILD_CLIENT_PROFILE=official corepack pnpm exec tsx scripts/build-exe-for-python-sdk.ts --targets=node24-linux-arm64)

(cd "$PACKAGE_ROOT" && corepack pnpm install --frozen-lockfile)
(cd "$PACKAGE_ROOT" && corepack pnpm run build)
(cd "$PACKAGE_ROOT" && corepack pnpm run test)
(cd "$PACKAGE_ROOT" && node lib/stage-runtime.js \
  --source-dir "$SOURCE_DIR/dist-exe" \
  --source-ref "$SOURCE_REF" \
  --source-commit "$SOURCE_COMMIT" \
  --repository-version "$VERSION")

OFFICE_DIR="$PACKAGE_ROOT/office"
if [ -d "$OFFICE_DIR/downloads" ]; then
  echo "build-on-arm64: staging offline Office runtime..."
  mkdir -p "$OFFICE_DIR/python"
  tar -xzf "$OFFICE_DIR/downloads"/cpython-*.tar.gz -C "$OFFICE_DIR"
  SITE_PACKAGES="$OFFICE_DIR/python/lib/python3.10/site-packages"
  mkdir -p "$SITE_PACKAGES"
  for wheel in "$OFFICE_DIR/downloads/wheels-arm64"/*.whl; do
    python3 -m zipfile -e "$wheel" "$SITE_PACKAGES"
  done
  if python3 -m pip --version >/dev/null 2>&1; then
    python3 -m pip download --dest "$OFFICE_DIR/downloads/wheels-arm64" --only-binary=:all: --no-deps pypdf || true
    for pypdf_wheel in "$OFFICE_DIR/downloads/wheels-arm64"/pypdf*.whl; do
      if [ -f "$pypdf_wheel" ]; then
        python3 -m zipfile -e "$pypdf_wheel" "$SITE_PACKAGES"
      fi
    done
  fi
  chmod 755 "$OFFICE_DIR/dsh-office" "$OFFICE_DIR/dsh-python"
  chmod -R 755 "$OFFICE_DIR/python/bin"
  chmod 644 "$OFFICE_DIR/office_tool.py"
  rm -rf "$OFFICE_DIR/downloads"
fi
chmod 755 "$PACKAGE_ROOT/build"/deb-*.sh

(cd "$PACKAGE_ROOT" && corepack pnpm run smoke-runtime)
(cd "$PACKAGE_ROOT" && corepack pnpm run dist)
(cd "$PACKAGE_ROOT" && bash scripts/verify-linux-artifacts.sh "$VERSION")

echo "build-on-arm64: verified artifacts are under $PACKAGE_ROOT/dist"
