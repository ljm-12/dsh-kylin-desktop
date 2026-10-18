# Official DeepSeek Harness Desktop for Kylin ARM64

English | [中文](README.zh.md)

Build upstream `dsh-v0.2.1-rc.2` at `687f282e8625c6b8d11ff58211a90524be2e4317`. Desktop runtime, product UI, account service, connection recovery, plugins and HTTP forwarding use the official code, with the Linux shell adaptations below. Sign-in and recovery follow the pinned upstream version.


This repository adds no custom plugins or replacement product features. The target is Kylin V10 SP1 ARM64 with UKUI and GLIBC 2.28; installation and intranet model calls still require target-machine acceptance.

## Minimal packaging compatibility

Upstream declares only macOS/Windows desktop targets. This repository adds Linux ARM64 build paths, Debian installation, a manylinux 2.28 rebuild of the packaged node-pty, and integrity checks. An Office ASAR adjustment treats both null and undefined missing entries as absent for the official Linux WASM fallback. A ws sender adjustment sends empty frames as a single header write, omitting the zero-length payload iovec while preserving the exact frame bytes. Both adjustments are recorded with hashes in `BUILD-INFO.json` and in `RUNTIME-PATCH.diff`.

A strict source gate allows changes to nine platform build/CLI files, exact Linux tray and caption adaptations in the desktop main process and two preloads, and a byte-checked Linux process cleanup module. The remaining runtime, product UI and shared styles stay unchanged. Packaged Connection and Gateway modules must byte-match the official compilation. The Linux workspace reuses the official 40px integrated caption: application/edit menus and Electron minimize/maximize/close buttons share one row, replacing the system titlebar and separate native menu bar. Caption dragging, theme colors and fullscreen state use the official implementation; secondary windows keep their system frame. Linux uses upstream lockfile Electron 44.7.0, which includes the UKUI tray registration fix. The old 44.5.1 override and obsolete runtime platform-selection patch are removed. Runtime preparation and electron-builder read the same installed upstream dependency; the official lockfile stays unchanged. The pnpm smoke path follows the new primary-runtime layout.

## Public proxy CA

Store the public root and intermediate CA PEM bundle in Actions secret `DMZ_PROXY_CA_CERT`. The build injects the ignored `config/proxy-root-ca.crt` (the existing filename now holds the complete CA bundle), validates every CA and expiry, rejects duplicate certificates, compares final packaged bytes, and removes the injected runner file afterward. Certificates and `DMZ_cert/` are never committed; private keys are rejected.

Desktop and official CLI launchers default NODE_EXTRA_CA_CERTS to the bundled CA and preserve explicit overrides. Proxy environment variables are preserved. Kylin launch compatibility remains: X11/XWayland when DISPLAY exists and GPU acceleration disabled by default (DSH_ENABLE_GPU=1 restores it). Sandbox remains enabled by default; DSH_KYLIN_NO_SANDBOX=1 is an explicit target-machine override. Node Host/CLI trust does not replace Chromium/system trust. Configure model endpoints and credentials through official settings.

## Build and verification

Dispatch [Build Kylin ARM64 official desktop](https://github.com/ljm-12/dsh-kylin-desktop/actions/workflows/build-kylin-arm64-desktop.yml) on `master` with `dsh-v0.2.1-rc.2`. Native Linux ARM64 builds produce a Debian artifact, SHA256SUMS, BUILD-INFO.json, UPSTREAM-PATCH.diff and RUNTIME-PATCH.diff. No Release is published or artifact downloaded automatically. Retention is 30 days.

Checks cover real Electron Node TLS with root-only failure and root-plus-intermediate success for the intranet certificate chain, official Host/Office smoke and integrity, ARM64 and GLIBC <= 2.28 for external ELF payloads, compressed RPC and event streams, and 60-second real official page/Host WebSocket/SSE continuity for both materialized and final ASAR payloads. The final package also launches the actual installed wrapper and official main process, uses the official welcome Skip action, and checks the workspace for 60 seconds with stable WebSocket/SSE and no document reload. Openbox and xdotool check that the workspace has no system titlebar, then exercise caption dragging, native overlay maximize/restore/minimize/close buttons, and tray restore. A disposable D-Bus StatusNotifier host verifies tray registration, a usable icon, activation, Show and Quit menu actions, and clean process exit. A separate native Electron fixture checks the adapted window and official caption CSS before full packaging. Drag input waits for Electron and the X11 window manager between press, motion and release; tests use a 1600×1000 virtual screen with room to move the window. The temporary debugging port and profile apply only to CI. Tests use disposable profiles. Cloud checks do not establish Kylin intranet acceptance.

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt node scripts/prepare-proxy-ca.mjs
DSH_TEST_SOURCE=/path/to/pinned/official/checkout node --test tests/*.test.mjs
bash -n scripts/*.sh build/*.sh
```

Full packaging requires native Linux ARM64, Node 24, Corepack, Docker, compiler tools, musl-tools, Electron libraries, OpenSSL, readelf, dpkg, Xvfb, Openbox, xdotool, xprop, D-Bus, python3-dbus and python3-gi:

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt bash scripts/build-on-arm64.sh /path/to/official/checkout dsh-v0.2.1-rc.2
```

## After downloading

Fully quit the previous application, including its tray process. Extract the artifact, run `sha256sum -c SHA256SUMS`, then install:

```bash
sudo apt install ./DeepSeek-Harness-Kylin-ARM64-0.2.1-rc.2.deb
dpkg-query -W -f='${Version}\n' deepseek-harness-kylin
```

Compare the Debian revision with BUILD-INFO.json; application version remains 0.2.1-rc.2. Start from the desktop menu, observe connection status, then test an intranet conversation and restart. The bundled root and intermediate CAs load automatically; no additional certificate file or launch environment variable is needed. Existing user configuration and data are preserved; manually configured policies are not automatically removed. Retain logs and data if connections still fail.

Package identity remains DeepSeek Harness Kylin. The old dsh-intranet command alias runs the same official desktop for upgrade compatibility. Older carrier profiles are not automatically migrated or deleted.

## WebSocket compatibility

Kylin V10 SP1 reported `EFAULT / write` immediately after the first empty Ping, closing the connection with code 1006. The ws sender patch omits the zero-length payload iovec and writes the same complete frame header. Upstream heartbeat timing, frame bytes, masking, compression and callbacks remain unchanged. Historical target-machine diagnostics for 0.2.0-rc.2 showed approximately 250 seconds without disconnects; this does not establish target-machine acceptance of the new version.

Regression checks reproduce the original failure under EFAULT injection, compare 40 frame encodings byte for byte, and verify 30 successful empty Ping/Pong cycles, data/compression and a clean close. They run before packaging and against the final ASAR. These test fixtures are not included in the app.

The regular package uses the official `lib/main.js` entrypoint with an exact Linux shell adaptation: a PNG taskbar and tray icon, close-to-tray, click or menu restore, and graceful menu quit. After upstream Host/storage shutdown, Linux terminates remaining owned descendants, including previously observed detached workers; process start times prevent signalling a reused PID. If tray creation fails, closing requests quit instead of leaving a hidden process. Tests reject the combined bus-name/path registration that UKUI rejects, access the item through its unique D-Bus owner, and check detached processes after menu quit. Temporary transport diagnostics and diagnostic preload hooks have been removed; it no longer writes `DeepSeek-Harness-connection-diagnostics.jsonl`. Existing logs belong to older diagnostic builds. Official session, attachment and model-output storage still follows upstream behavior.
