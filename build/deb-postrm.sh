#!/usr/bin/env bash
set -e

action="$1"

case "$action" in
  remove|purge)
    # 1. Remove alternatives for main binary
    if type update-alternatives >/dev/null 2>&1; then
      update-alternatives --remove deepseek-harness-kylin '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' || true
    fi

    # 2. Clean up symlinks in /usr/bin
    rm -f /usr/bin/deepseek-harness-kylin
    rm -f /usr/bin/dsh-intranet
    rm -f /usr/bin/dsh
    rm -f /usr/bin/deepseek-harness
    rm -f /usr/bin/dsh-office
    rm -f /usr/bin/dsh-browser
    rm -f /usr/bin/dsh-python

    # 2.1 KySec security whitelist cleanup (Galaxy Kylin)
    if command -v kysec_set >/dev/null 2>&1; then
      for target_bin in \
        "/opt/DeepSeek Harness Kylin/deepseek-harness-kylin" \
        "/opt/DeepSeek Harness Kylin/deepseek-harness-kylin.bin" \
        "/opt/DeepSeek Harness Kylin/chrome-sandbox" \
        "/opt/DeepSeek Harness Kylin/resources/runtime/deepseek-harness-sdk-runtime-linux-arm64" \
        "/opt/DeepSeek Harness Kylin/resources/runtime/ripgrep"; do
        kysec_set -n exectl -m del -t "$target_bin" 2>/dev/null || true
        kysec_set -n appctl -m del -t "$target_bin" 2>/dev/null || true
      done
    fi

    # 3. Refresh desktop and mime databases
    if hash update-mime-database 2>/dev/null; then
      update-mime-database /usr/share/mime || true
    fi
    if hash update-desktop-database 2>/dev/null; then
      update-desktop-database -q /usr/share/applications || true
    fi
    ;;
  upgrade|failed-upgrade|abort-install|abort-upgrade)
    ;;
  *)
    ;;
esac

exit 0
