#!/usr/bin/env bash
set -e

# 1. Backward compatibility: symlink /usr/bin/dsh-intranet -> /usr/bin/deepseek-harness-kylin
ln -sf "/usr/bin/deepseek-harness-kylin" /usr/bin/dsh-intranet

# 2. Clean up legacy /opt/dsh-intranet (removes old binaries without touching user home data)
if [ -d "/opt/dsh-intranet" ]; then
  rm -rf /opt/dsh-intranet
fi

# 3. Symlink dsh-office and dsh-python into /usr/bin/
OFFICE_TARGET="/opt/DeepSeek Harness Kylin/resources/office"
if [ -f "$OFFICE_TARGET/dsh-office" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-office"
  ln -sf "$OFFICE_TARGET/dsh-office" /usr/bin/dsh-office
fi
if [ -f "$OFFICE_TARGET/dsh-python" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-python"
  ln -sf "$OFFICE_TARGET/dsh-python" /usr/bin/dsh-python
fi

# 4. Refresh desktop and icon database
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

exit 0
