import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { patchLinuxTray } from '../scripts/linux-tray-adapter.mjs'
import { patchOfficialDesktop } from '../scripts/patch-official-desktop.mjs'
import { verifyOfficialSource } from '../scripts/verify-official-source.mjs'

const upstream = process.env.DSH_TEST_SOURCE
const options = { skip: !upstream }
const originalMain = () => readFileSync(join(upstream, 'apps/desktop/src/main.ts'), 'utf8')

test('Linux close keeps work running with a tray and quits when tray creation failed', options, () => {
  const source = patchLinuxTray(originalMain())
  const start = source.indexOf("    window.on('close', (event) => {")
  const handler = source.slice(start, source.indexOf("\n    if (process.platform === 'win32') {", start))
  for (const platform of ['linux', 'win32', 'darwin']) {
    for (const tray of [undefined, {}]) {
      let close, hidden = 0, quit = 0, prevented = 0
      const context = { process: { platform }, tray, quitting: false, shellInstallerOwnsQuit: false,
        sessionEnding: false, backgroundNotice: undefined,
        app: { quit: () => quit++ }, updateDialog: { isOpen: false },
        window: { on: (_event, callback) => { close = callback }, isDestroyed: () => false },
        hideMainWindow: () => hidden++ }
      runInNewContext(stripTypeScriptTypes(handler), context)
      close({ preventDefault: () => prevented++ })
      assert.equal(prevented, 1)
      assert.equal(hidden, platform === 'linux' && !tray ? 0 : 1)
      assert.equal(quit, platform === 'linux' && !tray ? 1 : 0)
      context.quitting = true
      close({ preventDefault: () => prevented++ })
      assert.equal(prevented, 1, 'Confirmed quit must let the window close normally')
    }
  }
})

test('Linux publishes a PNG taskbar icon without opting out of the taskbar', options, () => {
  const source = patchLinuxTray(originalMain())
  const start = source.indexOf('  const window = new BrowserWindow({')
  const create = source.slice(start, source.indexOf('\n  window.webContents.setWindowOpenHandler', start))
  for (const platform of ['linux', 'win32', 'darwin']) {
    let supplied
    runInNewContext(stripTypeScriptTypes(create), {
      BrowserWindow: class { constructor(value) { supplied = value } },
      process: { platform, resourcesPath: '/installed/resources' },
      app: { isPackaged: true }, join, primary: true, preload: 'preload.cjs', show: false,
      WINDOWS_TITLEBAR_HEIGHT: 36, chromeFallbackFill: () => '#ffffff',
      nativeTheme: { shouldUseDarkColors: false },
    })
    assert.equal(supplied.icon, platform === 'linux' ? '/installed/resources/icon.png' : undefined)
    assert.equal(supplied.skipTaskbar, platform === 'linux' ? false : undefined)
  }
})

test('Linux quit waits for official Host/storage teardown before reaping workers and exiting', options, async () => {
  const source = patchLinuxTray(originalMain())
  const start = source.indexOf('  const finishQuit = (): void => {')
  const handler = stripTypeScriptTypes(source.slice(start, source.indexOf("  app.on('before-quit'", start)))
  for (const platform of ['linux', 'win32']) {
    const events = []
    let releaseHost
    const host = new Promise(resolve => { releaseHost = resolve })
    const context = { quitting: false, shuttingDown: false, updateJournal: undefined,
      quitConfirmation: { dispose() {} }, backgroundNotice: undefined, tray: undefined, stopAccount: undefined,
      welcomeWindow: undefined, mainWindow: undefined, updateSchedule: { dispose() {} },
      updateDialog: { dispose() {} }, mandatoryUI: undefined, mandatoryPolicy: undefined, policyAuth: undefined,
      backend: { close: () => host }, platformView: { dispose: () => Promise.resolve() },
      kylinProcesses: platform === 'linux' ? { stop: async () => { events.push('workers-stopped') } } : undefined,
      app: { quit: () => events.push('quit'), exit: code => events.push(`exit-${code}`) }, console }
    runInNewContext(handler + '\nfinishQuit();', context)
    assert.deepEqual(events, [], 'Cleanup must not interrupt the pending official shutdown')
    releaseHost()
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(events, platform === 'linux' ? ['workers-stopped', 'quit'] : ['quit'])
  }
})

test('upstream tray routes icon activation and menu actions through open and graceful quit', options, () => {
  const source = readFileSync(join(upstream, 'apps/desktop/src/tray.ts'), 'utf8')
  const context = { Menu: { buildFromTemplate: items => items },
    nativeImage: { createFromPath: path => ({ path }) },
    Tray: class {
      constructor(icon) { context.instance = this; this.icon = icon; this.events = {}; this.destroyed = 0 }
      on(name, callback) { this.events[name] = callback }
      setToolTip(value) { this.tooltip = value }
      setContextMenu(value) { this.menu = value }
      destroy() { this.destroyed++ }
    } }
  runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }).replace(/^import.*$/mg, '').replace('export class', 'class')
    + '\nglobalThis.DesktopTray = DesktopTray;', context)
  let opened = 0, quit = 0
  const tray = new context.DesktopTray({ iconPath: 'icon.png',
    locale: () => ({ messages: { aboutProduct: 'DeepSeek Harness', openApplication: '显示窗口', quitApplication: '退出' } }),
    open: () => opened++, quit: () => quit++ })
  context.instance.events.click()
  context.instance.menu[0].click()
  context.instance.menu[2].click()
  assert.equal(opened, 2)
  assert.equal(quit, 1)
  assert.equal(context.instance.menu[0].label, '显示窗口')
  tray.dispose()
  tray.dispose()
  assert.equal(context.instance.destroyed, 1)
})

test('source gate rejects any main-process edits beyond the exact Linux tray adapter', options, () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-tray-source-gate-'))
  const source = join(root, 'source')
  try {
    execFileSync('git', ['clone', '--quiet', '--shared', upstream, source])
    patchOfficialDesktop(source)
    verifyOfficialSource(source)
    const cleanup = join(source, 'apps/desktop/src/kylin-process-tree.ts')
    const originalCleanup = readFileSync(cleanup, 'utf8')
    writeFileSync(cleanup, originalCleanup + '\n// unrelated process control\n')
    assert.throws(() => verifyOfficialSource(source), /process cleanup must match/)
    writeFileSync(cleanup, originalCleanup)
    const main = join(source, 'apps/desktop/src/main.ts')
    writeFileSync(main, readFileSync(main, 'utf8') + '\n// unrelated change\n')
    assert.throws(() => verifyOfficialSource(source), /exact Linux tray adapter/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
