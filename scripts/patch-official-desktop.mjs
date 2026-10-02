import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Only extend platform selectors. Product behavior remains owned by upstream.
export function patchOfficialDesktop(root) {
  function edit(file, changes) {
    const path = resolve(root, file)
    let source = readFileSync(path, 'utf8')
    for (const [before, after] of changes) {
      if (source.includes(after)) continue
      if (!source.includes(before)) throw new Error(`Unsupported official source: ${file}: ${before}`)
      source = source.replace(before, after)
    }
    writeFileSync(path, source)
    console.log(`Kylin platform adapter: ${file}`)
  }
  edit('apps/desktop/scripts/desktop-build-paths.mjs', [
    ["new Set(['mac-arm64', 'mac-x64', 'win-x64'])", "new Set(['mac-arm64', 'mac-x64', 'win-x64', 'linux-arm64'])"],
    ["target === 'win-x64' ? 'win32' : 'darwin'", "target === 'win-x64' ? 'win32' : target === 'linux-arm64' ? 'linux' : 'darwin'"],
    ["target === 'mac-arm64' ? 'arm64' : 'x64'", "target.endsWith('-arm64') ? 'arm64' : 'x64'"],
  ])
  edit('apps/desktop/scripts/desktop-build-paths.d.mts', [
    ["import type { DesktopAutoUpdateTarget }", "import type { DesktopAutoUpdateTarget as OfficialDesktopTarget }"],
    ["export interface DesktopTargetBuildPaths", "type DesktopAutoUpdateTarget = OfficialDesktopTarget | 'linux-arm64'\n\nexport interface DesktopTargetBuildPaths"],
    ["readonly platform: 'darwin' | 'win32'", "readonly platform: 'darwin' | 'win32' | 'linux'"],
  ])
  edit('apps/desktop/scripts/prepare-runtime.ts', [
    ["target.startsWith('mac-') ? 'darwin' : 'win32'", "target.startsWith('mac-') ? 'darwin' : target.startsWith('linux-') ? 'linux' : 'win32'"],
    ["platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'", "platform === 'win32' ? 'electron.exe' : platform === 'linux' ? 'electron' : 'Electron.app/Contents/MacOS/Electron'"],
  ])
  edit('apps/desktop/scripts/prepare-cli.ts', [
    ["platform: 'darwin' | 'win32'", "platform: 'darwin' | 'win32' | 'linux'"],
    ["platform === 'darwin') chmodSync", "platform !== 'win32') chmodSync"],
  ])
  edit('apps/desktop/scripts/prepare-dsh.ts', [
    ["process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron'",
      "process.platform === 'win32' ? 'electron.exe' : process.platform === 'linux' ? 'electron' : 'Electron.app/Contents/MacOS/Electron'"],
  ])
  edit('apps/desktop/scripts/development-project.ts', [
    ["readonly target: DesktopAutoUpdateTarget", "readonly target: DesktopAutoUpdateTarget | 'linux-arm64'"],
  ])
  edit('apps/desktop/scripts/electron-builder-config.mjs', [
    ["const policy = resolveDesktopPolicyEnvironment(env)",
      "const policy = (env.DSH_DESKTOP_TARGET_PLATFORM ?? hostPlatform) === 'linux' ? undefined : resolveDesktopPolicyEnvironment(env)"],
    ["const update = unsigned ? undefined : resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)",
      "const update = unsigned || resolvedPlatform === 'linux' ? undefined : resolveDesktopAutoUpdateConfig(env, resolvedPlatform, resolvedArch)"],
  ])
  // The official POSIX CLI launcher currently has a macOS bundle path.
  edit('apps/desktop/cli/dsh', [
    ['ELECTRON_RUN_AS_NODE=1 exec "$resources/../MacOS/DeepSeek Harness"',
      'export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$resources/config/proxy-root-ca.crt}"\nELECTRON_RUN_AS_NODE=1 exec "$resources/../deepseek-harness-kylin.bin"'],
  ])
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: patch-official-desktop.mjs <official-source>')
  patchOfficialDesktop(resolve(process.argv[2]))
}
