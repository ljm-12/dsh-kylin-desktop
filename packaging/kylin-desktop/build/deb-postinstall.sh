#!/usr/bin/env bash
set -e

# 1. Standard Electron installation hooks
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/deepseek-harness-kylin' -a -e '/usr/bin/deepseek-harness-kylin' -a "$(readlink '/usr/bin/deepseek-harness-kylin')" != '/etc/alternatives/deepseek-harness-kylin' ]; then
    rm -f '/usr/bin/deepseek-harness-kylin'
  fi
  update-alternatives --install '/usr/bin/deepseek-harness-kylin' 'deepseek-harness-kylin' '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' 100 || ln -sf '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' '/usr/bin/deepseek-harness-kylin'
else
  ln -sf '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' '/usr/bin/deepseek-harness-kylin'
fi

if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
  chmod 4755 '/opt/DeepSeek Harness Kylin/chrome-sandbox' || true
else
  chmod 0755 '/opt/DeepSeek Harness Kylin/chrome-sandbox' || true
fi

# 2. Backward compatibility: symlink /usr/bin/dsh-intranet -> /usr/bin/deepseek-harness-kylin
ln -sf "/usr/bin/deepseek-harness-kylin" /usr/bin/dsh-intranet

# 3. Clean up legacy /opt/dsh-intranet (removes old binaries without touching user home data)
if [ -d "/opt/dsh-intranet" ]; then
  rm -rf /opt/dsh-intranet
fi

# 4. Symlink dsh-office and dsh-python into /usr/bin/
OFFICE_TARGET="/opt/DeepSeek Harness Kylin/resources/office"
if [ -f "$OFFICE_TARGET/dsh-office" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-office"
  ln -sf "$OFFICE_TARGET/dsh-office" /usr/bin/dsh-office
fi
if [ -f "$OFFICE_TARGET/dsh-python" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-python"
  ln -sf "$OFFICE_TARGET/dsh-python" /usr/bin/dsh-python
fi

# 5. Refresh desktop and mime databases
if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database -q /usr/share/applications || true
fi

exit 0
