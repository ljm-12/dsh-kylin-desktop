# Official DeepSeek Harness Desktop for Kylin ARM64

English | [中文](README.zh.md)

Build upstream `dsh-v0.2.0-rc.2` at `639ed015397290b3745d163aafe02ffee4aa3f84`. Desktop runtime, product UI, account service, connection recovery, plugins and HTTP forwarding use the official code, with the Linux shell adaptations below. Sign-in and recovery follow the pinned upstream version.

## Minimal packaging compatibility

Upstream declares only macOS/Windows desktop targets. This repository adds Linux ARM64 build paths, Debian installation, a manylinux 2.28 rebuild of the packaged node-pty, and integrity checks. An Office ASAR adjustment treats both null and undefined missing entries as absent for the official Linux WASM fallback. A ws sender adjustment sends empty frames as a single header write, omitting the zero-length payload iovec while preserving the exact frame bytes. Both adjustments are recorded with hashes in `BUILD-INFO.json` and in `RUNTIME-PATCH.diff`.

A strict source gate allows changes to eight platform build/CLI files, exact Linux tray and caption adaptations in the desktop main process and two preloads, and a byte-checked Linux process cleanup module. The remaining runtime, product UI and shared styles stay unchanged. Packaged Connection and Gateway modules must byte-match the official compilation. The Linux workspace reuses the official 40px integrated caption: application/edit menus and Electron minimize/maximize/close buttons share one row, replacing the system titlebar and separate native menu bar. Caption dragging, theme colors and fullscreen state use the official implementation; secondary windows keep their system frame. Linux pins Electron 44.5.1, including the upstream fix for the invalid tray registration in 44.0.0 ([Electron #53214](https://github.com/electron/electron/pull/53214)). The official dependency lockfile remains unchanged; runtime preparation and electron-builder use the same explicit Linux version.

## Public proxy CA

Store the public root and intermediate CA PEM bundle in Actions secret `DMZ_PROXY_CA_CERT`. The build injects the ignored `config/proxy-root-ca.crt` (the existing filename now holds the complete CA bundle), validates every CA and expiry, rejects duplicate certificates, compares final packaged bytes, and removes the injected runner file afterward. Certificates and `DMZ_cert/` are never committed; private keys are rejected.

Desktop and official CLI launchers default NODE_EXTRA_CA_CERTS to the bundled CA and preserve explicit overrides. Proxy environment variables are preserved. Kylin launch compatibility remains: X11/XWayland when DISPLAY exists and GPU acceleration disabled by default (DSH_ENABLE_GPU=1 restores it). Sandbox remains enabled by default; DSH_KYLIN_NO_SANDBOX=1 is an explicit target-machine override. Node Host/CLI trust does not replace Chromium/system trust. Configure model endpoints and credentials through official settings.

## Build and verification

Dispatch [Build Kylin ARM64 official desktop](https://github.com/ljm-12/dsh-kylin-desktop/actions/workflows/build-kylin-arm64-desktop.yml) on `master` with `dsh-v0.2.0-rc.2`. Native Linux ARM64 builds produce a Debian artifact, SHA256SUMS, BUILD-INFO.json, UPSTREAM-PATCH.diff and RUNTIME-PATCH.diff. No Release is published or artifact downloaded automatically. Retention is 30 days.

Checks cover real Electron Node TLS with root-only failure and root-plus-intermediate success for the intranet certificate chain, official Host/Office smoke and integrity, ARM64 and GLIBC <= 2.28 for external ELF payloads, compressed RPC and event streams, and 60-second real official page/Host WebSocket/SSE continuity for both materialized and final ASAR payloads. The final package also launches the actual installed wrapper and official main process, uses the official welcome Skip action, and checks the workspace for 60 seconds with stable WebSocket/SSE and no document reload. Openbox and xdotool check that the workspace has no system titlebar, then exercise caption dragging, native overlay maximize/restore/minimize/close buttons, and tray restore. A disposable D-Bus StatusNotifier host verifies tray registration, a usable icon, activation, Show and Quit menu actions, and clean process exit. The temporary debugging port and profile apply only to CI. Tests use disposable profiles. Cloud checks do not establish Kylin intranet acceptance.

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt node scripts/prepare-proxy-ca.mjs
DSH_TEST_SOURCE=/path/to/pinned/official/checkout node --test tests/*.test.mjs
bash -n scripts/*.sh build/*.sh
```

Full packaging requires native Linux ARM64, Node 24, Corepack, Docker, compiler tools, musl-tools, Electron libraries, OpenSSL, readelf, dpkg, Xvfb, Openbox, xdotool, xprop, D-Bus, python3-dbus and python3-gi:

```bash
DSH_PROXY_CA_CERT_FILE=/path/to/proxy-ca-bundle.crt bash scripts/build-on-arm64.sh /path/to/official/checkout dsh-v0.2.0-rc.2
```

## After downloading

Fully quit the previous application, including its tray process. Extract the artifact, run `sha256sum -c SHA256SUMS`, then install:

```bash
sudo apt install ./DeepSeek-Harness-Kylin-ARM64-0.2.0-rc.2.deb
dpkg-query -W -f='${Version}\n' deepseek-harness-kylin
```

Compare the Debian revision with BUILD-INFO.json; application version remains 0.2.0-rc.2. Start from the desktop menu, observe connection status, then test an intranet conversation and restart. The bundled root and intermediate CAs load automatically; no additional certificate file or launch environment variable is needed. Existing user configuration and data are preserved; manually configured policies are not automatically removed. Retain logs and data if connections still fail.

Package identity remains DeepSeek Harness Kylin. The old dsh-intranet command alias runs the same official desktop for upgrade compatibility. Older carrier profiles are not automatically migrated or deleted.

## WebSocket compatibility

Kylin V10 SP1 reported `EFAULT / write` immediately after the first empty Ping, closing the connection with code 1006. The ws sender patch omits the zero-length payload iovec and writes the same complete frame header. Upstream heartbeat timing, frame bytes, masking, compression and callbacks remain unchanged. Target-machine diagnostics after the fix showed approximately 250 seconds without disconnects or retries, with 124 Ping/Pong replies on one connection.

Regression checks reproduce the original failure under EFAULT injection, compare 40 frame encodings byte for byte, and verify 30 successful empty Ping/Pong cycles, data/compression and a clean close. They run before packaging and against the final ASAR. These test fixtures are not included in the app.

The regular package uses the official `lib/main.js` entrypoint with an exact Linux shell adaptation: a PNG taskbar and tray icon, close-to-tray, click or menu restore, and graceful menu quit. After upstream Host/storage shutdown, Linux terminates remaining owned descendants, including previously observed detached workers; process start times prevent signalling a reused PID. If tray creation fails, closing requests quit instead of leaving a hidden process. Tests reject the combined bus-name/path registration that UKUI rejects, access the item through its unique D-Bus owner, and check detached processes after menu quit. Temporary transport diagnostics and diagnostic preload hooks have been removed; it no longer writes `DeepSeek-Harness-connection-diagnostics.jsonl`. Existing logs belong to older diagnostic builds. Official session, attachment and model-output storage still follows upstream behavior.

## Automatically stored files

The pinned official source has the following storage behavior with its default configuration. These are source findings, not a measurement of the target machine's total disk usage.

| Files | Growth and cleanup |
| --- | --- |
| Connection diagnostics | Removed from this package. The WebSocket fix creates no files. Quit the old diagnostic build before upgrading; its existing JSONL files are not removed by installation. |
| Fatal crash reports | Written on fatal failures, not on each heartbeat. Each startup prunes older generated reports to the newest 10; this is not a strict limit during one process run. |
| `~/.dsh/sessions`, `attachments`, `storages` | Conversation events, attachment objects and per-session listing checkpoints grow with use. Sessions default to compressed JSONL; attachments are content-addressed. No aggregate quota or automatic session deletion is configured. Checkpoints replace their current document rather than create a periodic backup. |
| `~/.dsh/cache/attachments` and Chromium cache | Image variants and browser caches may grow with use. No aggregate application quota is configured. Official plugin responses use `no-store` to avoid caching a new bundle on every launch. |
| OS temp `dsh-spill-*` | Large tool results; files older than 30 days are eligible for a cleanup sweep at startup. Age retention does not impose a byte quota. |
| OS temp `dsh-subprocess-*` | Bash/PowerShell output spill files default to at most 64 MiB per stream. Completed files remain for recovery until external cleanup; the application does not cap their total number or age. |
| Update qualification journal | Disabled unless `DSH_DESKTOP_UPDATE_JOURNAL_DIR` is explicitly set. Enabled journals have no automatic retention; the packaged launcher does not set it. |

Ordinary console/telemetry logging does not append a local log file by default. Host stderr keeps a 64 KiB in-memory tail. Office conversion and workspace-comparison temporary directories are removed on normal completion/disposal; forced termination can leave residues. Full-text SQLite indexing is disabled by the default composition. None of these findings guarantees zero disk growth: saved conversations, attachments, image caches and retained command output are the main items to monitor during long-term use. File growth principally uses disk space and does not by itself establish a memory leak.
