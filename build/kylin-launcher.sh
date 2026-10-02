#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$DIR/resources/config/proxy-root-ca.crt}"
export NO_PROXY="127.0.0.1,localhost,::1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,*.local${NO_PROXY:+,$NO_PROXY}${no_proxy:+,$no_proxy}"
export no_proxy="$NO_PROXY"
if [[ ! -r "$NODE_EXTRA_CA_CERTS" ]]; then
  echo "DeepSeek Harness: cannot read proxy CA: $NODE_EXTRA_CA_CERTS" >&2
  exit 1
fi
if grep -Eq -- '-----BEGIN .*PRIVATE KEY-----' "$NODE_EXTRA_CA_CERTS"; then
  echo 'DeepSeek Harness: trust file must not contain a private key.' >&2
  exit 1
fi
ARGS=()
if [[ -n "${DISPLAY:-}" ]]; then
  export GDK_BACKEND="${GDK_BACKEND:-x11}"
  ARGS+=(--ozone-platform=x11)
fi
if [[ "${DSH_ENABLE_GPU:-0}" != 1 ]]; then
  ARGS+=(--disable-gpu --disable-accelerated-video-decode)
fi
# Some Kylin kernels prohibit sandbox startup. Opt in only after target diagnosis.
if [[ "${DSH_KYLIN_NO_SANDBOX:-0}" == 1 ]]; then ARGS+=(--no-sandbox); fi
exec "$DIR/deepseek-harness-kylin.bin" "${ARGS[@]}" "$@"
