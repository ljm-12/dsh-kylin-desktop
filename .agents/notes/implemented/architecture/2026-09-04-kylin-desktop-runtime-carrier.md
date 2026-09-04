# Agent Note: Kylin desktop Runtime carrier

Status: implemented

English | [中文](2026-09-04-kylin-desktop-runtime-carrier.zh.md)

## Problem

The Kylin ARM64 package needs to follow official Harness releases without waiting for or relabelling a community desktop binary. Building the Harness dependency tree inside Electron would couple native addons, client transport, and application lifecycle to Electron's Node ABI and recreate a second application composition.

## Decision

[`packaging/kylin-desktop`](../../../../packaging/kylin-desktop) is a private distribution project outside the npm release family. Its workflow checks out an exact `dsh-v*` tag from `deepseek-ai/deepseek-harness` and builds the official Linux ARM64 single-exe Runtime on `ubuntu-24.04-arm` through the repository-owned Runtime pipeline.

This carrier extends the [single-file Runtime distribution](2026-07-10-single-file-executable-sdk-runtime-distribution.md), [single dsh launcher](2026-08-22-single-dsh-application-launcher.md), and [ready Web UI](../feature/2026-08-12-open-ready-web-ui.md) decisions. Those notes retain authority for Runtime construction, application entry, and the authenticated readiness announcement.

The official Runtime remains a child process. Electron starts its shipped `web` profile with an intranet patch, browser handoff disabled, and port `0`; the `dsh web:` readiness line supplies the authenticated loopback URL loaded by `BrowserWindow`. The carrier never imports the Harness package graph into Electron and never defines another Harness application launcher.

The Runtime executable and its `-rg` sidecar remain adjacent under Electron resources. Build metadata records the official tag, commit, repository version, and hashes. The Debian and AppImage versions come from the official source manifest rather than the carrier's private package version.

The intranet patch disables the public DeepSeek route, model-visible Web access, feedback entry points, and telemetry while retaining Settings > Models with a local OpenAI-compatible starter route. The Electron process also sets the telemetry opt-out, removes credential-named inherited environment variables, accepts only authenticated IPv4 loopback readiness URLs, and redacts the process token from logs.

The child lifecycle has one owner from spawn through shutdown. Readiness uses the Runtime announcement rather than a delay; Electron shutdown sends `SIGTERM`, waits for exit, and escalates to `SIGKILL` only after its bounded interval. An exit before readiness rejects startup, while an exit after readiness is reported as an application failure.

## Verification

Carrier tests use per-test temporary directories and real child processes. They cover chunked readiness output, early exit diagnostics, unexpected post-readiness exit, token redaction, environment filtering, ARM64 ELF validation, and package configuration. The native workflow adds source-tag validation, the official manylinux 2.28 `node-pty` rebuild, a real authenticated Web Runtime smoke, package inspection, executable architecture and permissions, and checksums.

Target-image validation remains separate evidence. A release requires a real Kylin ARM64 installation and graphical smoke because an Ubuntu ARM64 build cannot prove Kylin's GTK, NSS, ALSA, display server, Electron sandbox, or AppImage runtime behavior.

## Alternatives considered

**Repackage a community desktop release.** Rejected because its tag can lag the official Runtime and makes a current package depend on another repository's release cadence and compiled application graph.

**Port the community in-process Electron host forward.** Rejected because it duplicates the application composition, IPC transport, dependency closure, and native-addon compatibility work already owned by the official `dsh` Runtime and Web profile.

**Cross-build the Runtime on Windows x64 or Linux x64 through QEMU.** Rejected because the official build requires the Linux target architecture for native `node-pty`; emulated derived processes do not provide the same artifact evidence as the repository's native ARM64 workflow.

**Ship only a browser launcher.** Rejected because it depends on the target system's browser integration and does not provide the requested self-contained desktop window. The Electron process remains small by loading the official local Web application instead of owning another UI.

## Consequences

An official tag can produce a Kylin candidate without a matching community desktop release, and Harness UI and application composition stay owned by the official Runtime. The maintained desktop code is limited to process lifecycle, loopback navigation, build metadata, intranet defaults, and Linux packaging.

Every candidate still needs a native ARM64 build and Kylin acceptance. A change to the official Runtime filename, sidecars, Web startup arguments, readiness line, profile patch ids, or authentication exchange fails the workflow and requires an explicit carrier update rather than a compatibility guess.
