# Kylin ARM64 desktop packaging

English | [中文](README.zh.md)

This project packages an exact official DeepSeek Harness tag as a Kylin ARM64 desktop application without importing a community desktop fork. A small Electron process starts the official single-file Runtime with its `web` profile and loads the authenticated loopback URL in a locked-down window.

## Build inputs

The GitHub workflow accepts one exact `dsh-v*` tag. It checks that the tag matches the official repository version and records the resolved commit in `BUILD-INFO.json`.

The build runs on `ubuntu-24.04-arm`. It follows the official Runtime workflow, including the manylinux 2.28 `node-pty` rebuild, and packages the resulting ARM64 executable with its required `-rg` sidecar.

Electron `43.4.0`, electron-builder `26.15.7`, TypeScript, and the tests are pinned by this directory's independent `pnpm-lock.yaml`. The target application does not include `electron-updater`.

## Run the build

Open the `Build Kylin ARM64 desktop` workflow and enter the official tag to package. The workflow emits one artifact containing the `.deb`, AppImage, `SHA256SUMS`, and `BUILD-INFO.json` files.

Without a remote workflow, copy this repository and a clean checkout of the official tag to a Linux ARM64 build machine, then run:

```sh
bash scripts/build-on-arm64.sh /path/to/official/deepseek-harness dsh-v0.1.3-alpha.1
```

The script refuses a non-ARM64 host, a branch or moving ref, a tag/version mismatch, and a package-manager version mismatch before it runs build code.

The build workflow owns the native Runtime and Electron packaging operation. The local commands below verify the carrier without claiming an ARM64 package from a non-ARM64 host.

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run test
```

## Runtime lifecycle

The Electron process starts the bundled Runtime with:

```text
--profile web --patch <intranet-policy> --no-open --port 0
```

Port `0` delegates allocation to the operating system. The window opens only after a complete authenticated `dsh web:` readiness line names an HTTP URL on `127.0.0.1`; any other address is rejected.

The window disables Node integration, enables context isolation and sandboxing, blocks new windows, and prevents navigation outside the Runtime origin. Runtime output is written to the user-data log after one-time URL tokens are redacted.

Closing Electron sends `SIGTERM`, waits for the Runtime to exit, and uses `SIGKILL` only after the bounded shutdown interval. An unexpected Runtime exit is reported to the user.

## Intranet policy and migration

[`config/intranet.cordis.patch.yml`](config/intranet.cordis.patch.yml) disables the public DeepSeek route, model-visible Web tool, DeepSeek search, host and UI feedback plugins, and telemetry. It supplies an editable `intranet-openai` OpenAI-compatible route whose initial endpoint is `http://127.0.0.1:8000/v1`.

Users configure the real intranet endpoint, model list, and credential in Settings > Models. Credentials remain in the Harness credential store and never enter the package or build metadata.

Note for migrations from legacy `dsh-intranet-agent`: the desktop security boundary scrubs sensitive environment variables (such as `*_API_KEY` and `*_SECRET`) before spawning the Runtime. Exporting `INTRANET_AGENT_API_KEY` in the shell is deliberately ignored. Configure API credentials in Settings > Models so they are stored safely in the Harness credential store.

## Verification boundaries

The local tests cover readiness parsing across output chunks, token redaction, environment scrubbing, early and unexpected exits, quiescent child shutdown, ARM64 ELF recognition, and package configuration.

The ARM64 workflow additionally checks source identity, the Runtime build, its authenticated Web root, Debian metadata, executable architecture and modes, packaged policy, AppImage architecture, and checksums.

A successful workflow does not prove the graphical application on Kylin. Release approval still requires installation, launch, model configuration, one conversation, one tool call, restart, and upgrade testing on the supported Kylin ARM64 image.

## Build outputs

The verified files use these names:

```text
DeepSeek-Harness-Kylin-ARM64-<version>.deb
DeepSeek-Harness-Kylin-ARM64-<version>.AppImage
SHA256SUMS
BUILD-INFO.json
```

The `.deb` is the primary Kylin artifact. AppImage is supplemental because its runtime requirements, including FUSE on some systems, vary across target images.
