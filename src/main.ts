import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { finished } from 'node:stream/promises'
import { app, BrowserWindow, dialog } from 'electron'
import { desktopCopy } from './locales.js'
import { createRuntimeEnvironment, RuntimeProcess, type RuntimeExit } from './runtime-process.js'
import { resolveRuntimeFiles, verifyExecutable } from './runtime-files.js'

const READY_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 10_000

let mainWindow: BrowserWindow | undefined
let runtime: RuntimeProcess | undefined
let runtimeLog: WriteStream | undefined
let quitting = false

function exitDescription(result: RuntimeExit): string {
  return `code=${String(result.code)}, signal=${String(result.signal)}`
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
  const log = createWriteStream(join(userData, 'runtime.log'), { flags: 'a', mode: 0o600 })
  runtimeLog = log
  const writeLog = (stream: 'stdout' | 'stderr', line: string): void => {
    log.write(`${new Date().toISOString()} ${stream}: ${line}\n`)
  }

  const runtimeEnv = createRuntimeEnvironment(process.env, dshHome)
  if (existsSync(files.skills)) {
    runtimeEnv.DSH_BUNDLED_SKILL_DIR = files.skills
  }
  if (existsSync(files.office)) {
    const currentPath = runtimeEnv.PATH ?? process.env.PATH ?? ''
    runtimeEnv.PATH = `${files.office}:${currentPath}`
  }

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
      dialog.showErrorBox(copy.runtimeExitTitle, copy.runtimeExit(exitDescription(result)))
      app.quit()
    },
  })
  runtime = owned

  try {
    const url = await owned.start()
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
        sandbox: true,
      },
    })
    mainWindow = window
    keepNavigationOnOrigin(window, url)
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      if (mainWindow === window) mainWindow = undefined
    })
    await window.loadURL(url.href)
  } catch (error) {
    await stopRuntime()
    throw error
  }
}

if (!app.requestSingleInstanceLock()) {
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
    dialog.showErrorBox(copy.startupFailureTitle, copy.startupFailure(reason))
    quitting = true
    app.exit(1)
  })
}
