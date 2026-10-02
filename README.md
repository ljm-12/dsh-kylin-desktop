# Official DeepSeek Harness Desktop packaging for Kylin ARM64

English | [中文](README.zh.md)

This repository builds `deepseek-ai/deepseek-harness/apps/desktop` directly. The former custom Electron window, Web Runtime carrier, credential handling and UI patches have been removed. UI, file selection, plugins, model settings, Office/PDF, browser capabilities and task features use upstream implementations. Optional functionality is enabled through upstream plugin management.

As verified on September 30, 2026, this build pins the release candidate `dsh-v0.2.0-rc.2` at `639ed015397290b3745d163aafe02ffee4aa3f84`. Upstream Desktop release scripts currently declare macOS and Windows targets; this adapter supplies Linux ARM64 paths, Debian installation and Kylin launch parameters.

## Local adaptations

- Extend upstream Linux ARM64 selectors while retaining upstream compilation, npm closure, Host, Office/interpreter preparation, integrity inventory and runtime smoke checks.
- Accept Electron ASAR's null result for missing files so the official Linux WASM Office fallback works; conversions retain upstream implementations.
- Rebuild the packaged `node-pty` against manylinux 2.28. Verify architecture and GLIBC <= 2.28 for every external ELF payload; incompatible artifacts fail verification.
- Prefer X11/XWayland when DISPLAY exists and disable GPU acceleration by default (`DSH_ENABLE_GPU=1` restores it). Keep upstream sandboxing; use `DSH_KYLIN_NO_SANDBOX=1` only after target diagnosis.
- Load the proxy CA and add the IPv4 CIDR NO_PROXY matching missing upstream. Loopback and RFC1918 LAN addresses bypass proxies; other traffic follows user configuration.
- Retain `config/intranet.cordis.patch.yml` as an optional deployment policy rather than changing product behavior.

## Proxy certificates

Certificate files and `DMZ_cert/` are ignored and must not be committed. Store only the public `DMZ_cert/root-ca.crt` PEM in the repository Actions secret `DMZ_PROXY_CA_CERT`. The build injects it into the ignored `config/proxy-root-ca.crt`, validates CA status/expiry and packaged bytes, and removes the injected file from the runner afterward. The installer still bundles the public CA; the launcher sets NODE_EXTRA_CA_CERTS before Electron and its Node Host start. Never commit or package `privkey.pem` or store it as a GitHub Secret. Ordinary adapter CI generates a disposable test CA and does not receive the real proxy certificate.

Desktop-menu launches load the bundled CA. An explicit override can point at another PEM trust bundle, including a full certificate chain:

```bash
NODE_EXTRA_CA_CERTS=/data/DMZ_cert/fullchain.pem deepseek-harness-kylin
```

The official `/usr/bin/dsh` CLI uses the same default CA. Configure reverse-proxy Base URL, model ID and API key in upstream Settings > Models. Certificate loading preserves TLS verification and does not replace model configuration. The URL hostname/IP must match the server certificate SAN. Node Host/CLI trust does not replace Chromium or system certificate stores.

## GitHub builds

Configure `DMZ_PROXY_CA_CERT` under repository Settings > Secrets and variables > Actions before building. A missing secret fails the build before dependency installation.

Dispatch [Build Kylin ARM64 official desktop](https://github.com/ljm-12/dsh-kylin-desktop/actions/workflows/build-kylin-arm64-desktop.yml) with `dsh-v0.2.0-rc.2`. It runs on native `ubuntu-24.04-arm`.

Successful builds produce an Actions artifact containing:

```text
DeepSeek-Harness-Kylin-ARM64-0.2.0-rc.2.deb
SHA256SUMS
BUILD-INFO.json
UPSTREAM-PATCH.diff
RUNTIME-PATCH.diff
```

Build metadata records upstream and packaging commits plus CA/patch hashes. The diffs expose the actual platform/proxy source changes and packaged Office compatibility adjustment. The workflow does not publish a Release or download locally; artifacts expire after 30 days.

Run dependency-free adapter checks locally:

```bash
DSH_PROXY_CA_CERT_FILE=DMZ_cert/root-ca.crt node scripts/prepare-proxy-ca.mjs
DSH_TEST_SOURCE=/path/to/pinned/official/checkout node --test tests/*.test.mjs
bash -n scripts/*.sh build/*.sh
```

Full packaging requires native Linux ARM64, Node 24, Corepack, Docker, compiler tools, musl-tools, Electron libraries, OpenSSL, readelf and dpkg:

```bash
DSH_PROXY_CA_CERT_FILE=DMZ_cert/root-ca.crt bash scripts/build-on-arm64.sh /path/to/official/checkout dsh-v0.2.0-rc.2
```

## Installation and previous data

```bash
sudo apt install ./DeepSeek-Harness-Kylin-ARM64-0.2.0-rc.2.deb
```

The application remains DeepSeek Harness Kylin with `deepseek-harness-kylin` and the `dsh-intranet` alias. Upstream Desktop uses the official Harness home (normally `~/.dsh`). Previous carrier data in `~/.config/dsh-kylin-desktop-packaging/runtime-home` is preserved and is not automatically migrated. Back it up and configure models/workspaces through upstream; avoid overwriting data across session-format versions.

Deployment administrators may merge the optional intranet policy into the upstream Desktop profile's `cordis.patch.yml` (normally `~/.dsh/profiles/desktop/cordis.patch.yml`), preserving existing plugin rows. Review its sample LAN endpoint, model names and plugin IDs against the deployed environment/version. User configuration is never automatically overwritten.

## Verification limits

Adapter tests perform real TLS handshakes: an unknown CA is rejected and the configured CA succeeds. ARM64 builds repeat this using Electron's actual Node mode, exercise upstream Host/Office smoke checks and inventory verification, and inspect Debian metadata and ELF payloads.

Kylin installation, desktop-menu launch, IME, real reverse-proxy traffic, a conversation/tool call, restart and upgrade still require target-machine validation. Handle KySec failures from concrete target rejection logs; no system-wide security disablement is performed.
