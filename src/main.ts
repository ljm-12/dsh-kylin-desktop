import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { app, BrowserWindow, dialog } from 'electron'
import { desktopCopy } from './locales.js'
import { createRuntimeEnvironment, RuntimeProcess, type RuntimeExit } from './runtime-process.js'
import { resolveRuntimeFiles, verifyExecutable } from './runtime-files.js'
import { reclaimStaleSingletonLock } from './single-instance.js'

const READY_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 10_000

let mainWindow: BrowserWindow | undefined
let runtime: RuntimeProcess | undefined
let runtimeLog: WriteStream | undefined
let quitting = false

function exitDescription(result: RuntimeExit): string {
  return `code=${String(result.code)}, signal=${String(result.signal)}`
}

/** Interface matching Electron's app.commandLine methods used for platform switches. */
export interface CommandLineSwitchTarget {
  appendSwitch: (switchName: string, value?: string) => void
  hasSwitch: (switchName: string) => boolean
}

/** Interface matching Electron's app methods used for platform switches. */
export interface AppCompatibilityTarget {
  disableHardwareAcceleration?: () => void
}

/**
 * Configure Linux desktop platform defaults to ensure compatibility.
 * On Linux (especially Kylin UKUI on ARM64 with proprietary GPU drivers like DATAN / Jingjiawei),
 * DRM master access is not available to user sessions ('drmSetInterfaceVersion() failed - not DRM_MASTER'),
 * which causes Chromium's EGL / VAAPI driver initialization to crash with SIGSEGV.
 * Defaulting to X11/XWayland backend, appending --no-sandbox (required on Kylin kernels where user
 * namespaces are disabled for non-root users), and disabling hardware acceleration guarantees rock-solid stability.
 * Note: Never set '--use-gl=disabled' as that causes BrowserWindow creation to crash with null pointer dereference.
 */
export function configureLinuxPlatformCompatibility(
  platform: string,
  env: NodeJS.ProcessEnv,
  commandLine: CommandLineSwitchTarget,
  appTarget?: AppCompatibilityTarget,
): void {
  if (platform !== 'linux') return
  if (!commandLine.hasSwitch('ozone-platform')) {
    commandLine.appendSwitch('ozone-platform', 'x11')
  }
  if (!env.GDK_BACKEND) {
    env.GDK_BACKEND = 'x11'
  }
  if (!commandLine.hasSwitch('no-sandbox')) {
    commandLine.appendSwitch('no-sandbox')
  }
  if (env.DSH_ENABLE_GPU !== '1') {
    if (typeof appTarget?.disableHardwareAcceleration === 'function') {
      appTarget.disableHardwareAcceleration()
    }
    if (!commandLine.hasSwitch('disable-gpu')) {
      commandLine.appendSwitch('disable-gpu')
    }
    if (!commandLine.hasSwitch('disable-dev-shm-usage')) {
      commandLine.appendSwitch('disable-dev-shm-usage')
    }
    if (!commandLine.hasSwitch('disable-accelerated-video-decode')) {
      commandLine.appendSwitch('disable-accelerated-video-decode')
    }
  }
}

function keepNavigationOnOrigin(window: BrowserWindow, allowed: URL): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, target) => {
    const candidate = new URL(target)
    if (candidate.origin !== allowed.origin) event.preventDefault()
  })
}

async function stopRuntime(): Promise<void> {
  const owned = runtime
  runtime = undefined
  await owned?.stop()
  const log = runtimeLog
  runtimeLog = undefined
  if (log !== undefined) {
    log.end()
    await finished(log).catch((_error: unknown) => {
      // Diagnostic logging cannot keep the already-terminated Runtime alive.
    })
  }
}

async function boot(): Promise<void> {
  const copy = desktopCopy(app.getLocale())
  const runtimeOverride = process.env.DSH_KYLIN_RUNTIME_PATH
  const files = resolveRuntimeFiles(process.resourcesPath, runtimeOverride)
  if (!existsSync(files.executable)) throw new Error(copy.runtimeMissing(files.executable))
  if (!existsSync(files.ripgrep)) throw new Error(copy.runtimeSidecarMissing(files.ripgrep))
  await verifyExecutable(files.executable)
  await verifyExecutable(files.ripgrep)

  const userData = app.getPath('userData')
  const dshHome = join(userData, 'runtime-home')
  const workspace = join(homedir(), 'AgentWorkspace')
  mkdirSync(dshHome, { recursive: true, mode: 0o700 })
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  const logPath = join(userData, 'runtime.log')
  const log = createWriteStream(logPath, { flags: 'a', mode: 0o600 })
  runtimeLog = log
  console.log(`[deepseek-harness] Runtime log: ${logPath}`)

  if (process.platform === 'linux') {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      console.warn('[deepseek-harness] Warning: Neither DISPLAY nor WAYLAND_DISPLAY is set in environment.')
      console.warn('[deepseek-harness] GUI window requires an active graphical display session (e.g. Kylin UKUI desktop).')
    } else {
      console.log(`[deepseek-harness] Display session: DISPLAY=${process.env.DISPLAY ?? '(unset)'}, WAYLAND_DISPLAY=${process.env.WAYLAND_DISPLAY ?? '(unset)'}`)
    }
  }

  const writeLog = (stream: 'stdout' | 'stderr', line: string): void => {
    log.write(`${new Date().toISOString()} ${stream}: ${line}\n`)
    console.log(`[deepseek-harness-runtime] ${stream}: ${line}`)
  }

  const runtimeEnv = createRuntimeEnvironment(process.env, dshHome)
  if (existsSync(files.skills)) {
    runtimeEnv.DSH_BUNDLED_SKILL_DIR = files.skills
  }
  if (existsSync(files.office)) {
    const currentPath = runtimeEnv.PATH ?? process.env.PATH ?? ''
    runtimeEnv.PATH = `${files.office}:${currentPath}`
  }

  console.log(`[deepseek-harness] Preparing runtime process: ${files.executable}`)
  const owned = new RuntimeProcess({
    command: files.executable,
    args: ['--profile', 'web', '--patch', files.patch, '--no-open', '--port', '0'],
    cwd: workspace,
    env: runtimeEnv,
    readyTimeoutMs: READY_TIMEOUT_MS,
    shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
    onLine: writeLog,
    onUnexpectedExit: (result) => {
      if (quitting) return
      const desc = exitDescription(result)
      console.error(`[deepseek-harness] Runtime exited unexpectedly: ${desc}`)
      try {
        dialog.showErrorBox(copy.runtimeExitTitle, copy.runtimeExit(desc))
      } catch {
        // Diagnostic dialog may fail in headless/non-interactive environments.
      }
      app.quit()
    },
  })
  runtime = owned

  try {
    console.log('[deepseek-harness] Starting runtime and awaiting readiness...')
    const url = await owned.start()
    console.log(`[deepseek-harness] Runtime ready at: ${url.origin}`)
    console.log('[deepseek-harness] Creating main browser window...')
    const window = new BrowserWindow({
      title: copy.appTitle,
      width: 1400,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      show: false,
      backgroundColor: '#101114',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    })

    mainWindow = window
    keepNavigationOnOrigin(window, url)
    window.once('ready-to-show', () => {
      console.log('[deepseek-harness] Browser window ready to show, revealing window')
      window.show()
    })
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = undefined
    })
    console.log('[deepseek-harness] Loading URL into browser window...')
    await window.loadURL(url.href)
    console.log('[deepseek-harness] Navigation completed')
    if (!window.isDestroyed() && !window.isVisible()) {
      console.log('[deepseek-harness] Window not visible after load, revealing now')
      window.show()
    }
  } catch (error) {
    console.error('[deepseek-harness] Boot sequence failed:', error)
    await stopRuntime()
    throw error
  }
}

if (typeof app?.requestSingleInstanceLock === 'function') {
  configureLinuxPlatformCompatibility(process.platform, process.env, app.commandLine, app)

  let hasLock = app.requestSingleInstanceLock()
  if (!hasLock && typeof app.getPath === 'function') {
    try {
      const reclaimed = reclaimStaleSingletonLock(app.getPath('userData'))
      if (reclaimed) {
        console.warn('[deepseek-harness] Cleared stale SingletonLock from terminated process. Retrying...')
        hasLock = app.requestSingleInstanceLock()
      }
    } catch {
      // Ignore cleanup inspection errors
    }
  }

  if (!hasLock) {
    console.warn('[deepseek-harness] Another instance is already running. Exiting.')
    app.quit()
  } else {
    app.on('second-instance', () => {
      if (mainWindow === undefined) return
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })
    app.on('window-all-closed', () => app.quit())
    app.on('before-quit', (event) => {
      if (quitting) return
      event.preventDefault()
      quitting = true
      void stopRuntime().finally(() => app.exit(0))
    })
    void app.whenReady().then(boot).catch((error: unknown) => {
      const copy = desktopCopy(app.getLocale())
      const reason = error instanceof Error ? error.message : String(error)
      console.error(`[deepseek-harness] Startup failure: ${reason}`)
      if (error instanceof Error && error.stack) {
        console.error(error.stack)
      }
      try {
        dialog.showErrorBox(copy.startupFailureTitle, copy.startupFailure(reason))
      } catch {
        // Diagnostic dialog may fail in headless/non-interactive environments.
      }
      quitting = true
      app.exit(1)
    })
  }
}
