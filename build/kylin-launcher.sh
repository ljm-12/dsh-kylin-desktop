#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$DIR/resources/config/proxy-root-ca.crt}"
if [[ ! -r "$NODE_EXTRA_CA_CERTS" ]]; then
  echo "DeepSeek Harness: cannot read proxy CA: $NODE_EXTRA_CA_CERTS" >&2
  exit 1
fi
if grep -Eq -- '-----BEGIN .*PRIVATE KEY-----' "$NODE_EXTRA_CA_CERTS"; then
  echo 'DeepSeek Harness: trust file must not contain a private key.' >&2
  exit 1
fi
# Kylin's X11/XWayland and GPU drivers need the compatibility launch path.
# These are platform options, independent of upstream account/connection logic.
if [[ -n "${DISPLAY:-}" ]]; then
  export GDK_BACKEND="${GDK_BACKEND:-x11}"
  set -- --ozone-platform=x11 "$@"
fi
if [[ "${DSH_ENABLE_GPU:-0}" != 1 ]]; then
  set -- --disable-gpu --disable-accelerated-video-decode "$@"
fi
# Keep sandboxing by default; explicit target-machine override is preserved.
if [[ "${DSH_KYLIN_NO_SANDBOX:-0}" == 1 ]]; then set -- --no-sandbox "$@"; fi
exec "$DIR/deepseek-harness-kylin.bin" "$@"
