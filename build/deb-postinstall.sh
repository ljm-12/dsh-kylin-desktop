#!/usr/bin/env bash
set -euo pipefail
APP_DIR='/opt/DeepSeek Harness Kylin'
test -x "$APP_DIR/deepseek-harness-kylin.bin"
test -x "$APP_DIR/deepseek-harness-kylin"
ln -sfn "$APP_DIR/deepseek-harness-kylin" /usr/bin/deepseek-harness-kylin
ln -sfn "$APP_DIR/deepseek-harness-kylin" /usr/bin/dsh-intranet
chmod 755 "$APP_DIR/resources/runtime/cli/bin/dsh"
if [[ ! -e /usr/bin/dsh && ! -L /usr/bin/dsh ]] || \
  [[ -L /usr/bin/dsh && "$(readlink /usr/bin/dsh)" == "$APP_DIR/"* ]]; then
  ln -sfn "$APP_DIR/resources/runtime/cli/bin/dsh" /usr/bin/dsh
else
  echo 'DeepSeek Harness: preserving existing /usr/bin/dsh; bundled CLI is in resources/runtime/cli/bin/dsh.' >&2
fi
if [[ -f "$APP_DIR/chrome-sandbox" ]]; then
  chown root:root "$APP_DIR/chrome-sandbox"
  chmod 4755 "$APP_DIR/chrome-sandbox"
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi
