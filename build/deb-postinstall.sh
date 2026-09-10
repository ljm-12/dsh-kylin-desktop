#!/usr/bin/env bash
set -e

# 0. Setup bash environment wrapper for Chinese IME and Kylin display compatibility
APP_DIR="/opt/DeepSeek Harness Kylin"
REAL_BIN="$APP_DIR/deepseek-harness-kylin.bin"
WRAPPER="$APP_DIR/deepseek-harness-kylin"

if [ -f "$WRAPPER" ] && [ ! -f "$REAL_BIN" ]; then
  mv "$WRAPPER" "$REAL_BIN"
fi

cat << 'EOF' > "$WRAPPER"
#!/usr/bin/env bash
# DeepSeek Harness Kylin environment wrapper for Chinese IME and display stability

# 1. Detect and configure Chinese input method before GTK3 C++ initialization
if [ -z "$GTK_IM_MODULE" ]; then
  if [ -n "$XMODIFIERS" ] && echo "$XMODIFIERS" | grep -q "ibus"; then
    export GTK_IM_MODULE=ibus
  elif [ -n "$XMODIFIERS" ] && echo "$XMODIFIERS" | grep -q "fcitx"; then
    export GTK_IM_MODULE=fcitx
  elif which fcitx5 >/dev/null 2>&1 || pgrep -x fcitx5 >/dev/null 2>&1; then
    export GTK_IM_MODULE=fcitx5
  elif which fcitx >/dev/null 2>&1 || pgrep -x fcitx >/dev/null 2>&1; then
    export GTK_IM_MODULE=fcitx
  elif which ibus-daemon >/dev/null 2>&1 || pgrep -x ibus-daemon >/dev/null 2>&1; then
    export GTK_IM_MODULE=ibus
  else
    export GTK_IM_MODULE=fcitx
  fi
fi

if [ -z "$QT_IM_MODULE" ]; then
  export QT_IM_MODULE="$GTK_IM_MODULE"
fi

if [ -z "$XMODIFIERS" ]; then
  export XMODIFIERS="@im=$GTK_IM_MODULE"
fi

if [ -z "$SDL_IM_MODULE" ]; then
  export SDL_IM_MODULE="$GTK_IM_MODULE"
fi

# 2. Prevent XDG portal hanging on UKUI desktop
export GTK_USE_PORTAL=0

# 3. Configure display backend flags
EXTRA_ARGS=()
if [ -n "$WAYLAND_DISPLAY" ] && [ -z "$DISPLAY" ]; then
  EXTRA_ARGS+=("--ozone-platform-hint=auto" "--enable-wayland-ime")
else
  export GDK_BACKEND=x11
  EXTRA_ARGS+=("--ozone-platform=x11")
fi

DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
exec "$DIR/deepseek-harness-kylin.bin" "${EXTRA_ARGS[@]}" "$@"
EOF

chmod 755 "$WRAPPER"
if [ -f "$REAL_BIN" ]; then
  chmod 755 "$REAL_BIN"
fi

# 1. Standard Electron installation hooks
if type update-alternatives >/dev/null 2>&1; then
  if [ -L '/usr/bin/deepseek-harness-kylin' -a -e '/usr/bin/deepseek-harness-kylin' -a "$(readlink '/usr/bin/deepseek-harness-kylin')" != '/etc/alternatives/deepseek-harness-kylin' ]; then
    rm -f '/usr/bin/deepseek-harness-kylin'
  fi
  update-alternatives --install '/usr/bin/deepseek-harness-kylin' 'deepseek-harness-kylin' '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' 100 || ln -sf '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' '/usr/bin/deepseek-harness-kylin'
else
  ln -sf '/opt/DeepSeek Harness Kylin/deepseek-harness-kylin' '/usr/bin/deepseek-harness-kylin'
fi

SANDBOX_BIN='/opt/DeepSeek Harness Kylin/chrome-sandbox'
if [ -f "$SANDBOX_BIN" ]; then
  chown root:root "$SANDBOX_BIN" 2>/dev/null || true
  chmod 4755 "$SANDBOX_BIN" 2>/dev/null || true
fi

# 2. Backward compatibility: symlink /usr/bin/dsh-intranet -> /usr/bin/deepseek-harness-kylin
ln -sf "/usr/bin/deepseek-harness-kylin" /usr/bin/dsh-intranet

# 3. Clean up legacy /opt/dsh-intranet (removes old binaries without touching user home data)
if [ -d "/opt/dsh-intranet" ]; then
  rm -rf /opt/dsh-intranet
fi

# 4. Symlink dsh-office, dsh-browser, and dsh-python into /usr/bin/
OFFICE_TARGET="/opt/DeepSeek Harness Kylin/resources/office"
if [ -f "$OFFICE_TARGET/dsh-office" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-office"
  ln -sf "$OFFICE_TARGET/dsh-office" /usr/bin/dsh-office
fi
if [ -f "$OFFICE_TARGET/dsh-browser" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-browser"
  ln -sf "$OFFICE_TARGET/dsh-browser" /usr/bin/dsh-browser
fi
if [ -f "$OFFICE_TARGET/dsh-python" ]; then
  chmod 755 "$OFFICE_TARGET/dsh-python"
  ln -sf "$OFFICE_TARGET/dsh-python" /usr/bin/dsh-python
fi

# 4.1 Symlink dsh runtime CLI into /usr/bin/dsh
RUNTIME_TARGET="/opt/DeepSeek Harness Kylin/resources/runtime/deepseek-harness-sdk-runtime-linux-arm64"
if [ -f "$RUNTIME_TARGET" ]; then
  chmod 755 "$RUNTIME_TARGET"
  ln -sf "$RUNTIME_TARGET" /usr/bin/dsh
  ln -sf "$RUNTIME_TARGET" /usr/bin/deepseek-harness
fi


# 5. KySec security whitelist registration (Galaxy Kylin)
if command -v kysec_set >/dev/null 2>&1; then
  echo "[deb-postinstall] Registering binaries with Kylin KySec security subsystem..."
  for target_bin in \
    "/opt/DeepSeek Harness Kylin/deepseek-harness-kylin" \
    "/opt/DeepSeek Harness Kylin/deepseek-harness-kylin.bin" \
    "/opt/DeepSeek Harness Kylin/chrome-sandbox" \
    "/opt/DeepSeek Harness Kylin/resources/runtime/deepseek-harness-sdk-runtime-linux-arm64" \
    "${RUNTIME_TARGET}-rg"; do
    if [ -f "$target_bin" ]; then
      if ! kysec_set -n exectl -m add -t "$target_bin"; then
        echo "[deb-postinstall] WARNING: KySec exectl registration failed for $target_bin. Check this system's kysec_set --help and Security Center execution-control policy." >&2
      fi
      if ! kysec_set -n appctl -m add -t "$target_bin"; then
        echo "[deb-postinstall] WARNING: KySec appctl registration failed for $target_bin. Check this system's kysec_set --help and Security Center application policy." >&2
      fi
    fi
  done
fi

# 6. Refresh desktop and mime databases
if hash update-mime-database 2>/dev/null; then
  update-mime-database /usr/share/mime || true
fi
if hash update-desktop-database 2>/dev/null; then
  update-desktop-database -q /usr/share/applications || true
fi

exit 0
