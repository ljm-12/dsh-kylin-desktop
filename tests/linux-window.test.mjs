import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { stripTypeScriptTypes } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { patchLinuxTray } from '../scripts/linux-tray-adapter.mjs'
import { patchLinuxWindow } from '../scripts/linux-window-adapter.mjs'

const upstream = process.env.DSH_TEST_SOURCE
const options = { skip: !upstream }
const source = file => {
  const original = execFileSync('git', ['-C', upstream, 'show', `HEAD:apps/desktop/src/${file}`], { encoding: 'utf8' })
  return patchLinuxWindow(`apps/desktop/src/${file}`, file === 'main.ts' ? patchLinuxTray(original) : original)
}

test('Linux main window uses the integrated caption and keeps taskbar identity; dialogs keep their frame', options, () => {
  const main = source('main.ts')
  const start = main.indexOf('  const window = new BrowserWindow({')
  const create = stripTypeScriptTypes(main.slice(start, main.indexOf('\n  window.webContents.setWindowOpenHandler', start)))
  for (const platform of ['linux', 'win32', 'darwin']) {
    for (const primary of [true, false]) {
      let supplied
      runInNewContext(create, {
        BrowserWindow: class { constructor(value) { supplied = value } },
        process: { platform, resourcesPath: '/installed/resources' },
        app: { isPackaged: true }, join, primary, preload: 'preload.cjs', show: false,
        WINDOWS_TITLEBAR_HEIGHT: 40, chromeFallbackFill: () => '#f9fafb',
        nativeTheme: { shouldUseDarkColors: false },
      })
      assert.equal(supplied.titleBarStyle, platform === 'darwin' ? 'hiddenInset' : primary ? 'hidden' : undefined)
      assert.equal(supplied.titleBarOverlay?.height, platform !== 'darwin' && primary ? 40 : undefined)
      assert.equal(supplied.icon, platform === 'linux' ? '/installed/resources/icon.png' : undefined)
      assert.equal(supplied.skipTaskbar, platform === 'linux' ? false : undefined)
      assert.equal(supplied.webPreferences.sandbox, true)
      assert.equal(supplied.webPreferences.contextIsolation, true)
    }
  }
})

test('Linux and Windows keep application menus in the caption without a separate native menu row', options, () => {
  const main = source('main.ts')
  const start = main.indexOf('  const refreshApplicationMenu = (): void => {')
  const refresh = stripTypeScriptTypes(main.slice(start, main.indexOf('\n  refreshApplicationMenu()', start)))
  for (const platform of ['linux', 'win32', 'darwin']) {
    let installed, relabelled = 0
    const controls = [{ role: 'toggleDevTools', visible: false }]
    runInNewContext(refresh + '\nrefreshApplicationMenu()', {
      process: { platform }, darwin: platform === 'darwin', app: { name: 'DeepSeek Harness' },
      Menu: { buildFromTemplate: items => items, setApplicationMenu: items => { installed = items } },
      devToolsItems: controls, applicationItems: () => [], platformMenus: () => [],
      currentDesktopLocale: () => ({ messages: { application: '应用' } }),
      tray: { relabel: () => relabelled++ },
    })
    assert.equal(installed === controls, platform !== 'darwin')
    assert.equal(relabelled, 1)
  }
})

test('Linux caption menus and palette retain the official top-frame and argument checks', options, async () => {
  const main = source('main.ts')
  const start = main.indexOf("  if (process.platform === 'win32' || process.platform === 'linux') {\n    ipcMain.handle")
  assert.ok(start > 0)
  const register = stripTypeScriptTypes(main.slice(start, main.indexOf('\n  const hideMainWindow', start)))
  for (const platform of ['linux', 'win32', 'darwin']) {
    let menu, appearance, colors, popup
    const frame = { url: 'dsh-app://app/' }
    const contents = { mainFrame: frame, getZoomFactor: () => 1.5 }
    const window = { webContents: contents, setTitleBarOverlay: value => { colors = value } }
    runInNewContext(register, {
      process: { platform }, mainWindow: window, SCHEME: 'dsh-app',
      ipcMain: { handle: (_channel, handler) => { menu = handler }, on: (_channel, handler) => { appearance = handler } },
      DESKTOP_IPC: { windowsMenu: 'menu', windowsAppearance: 'appearance' },
      assertDesktopSender: event => { assert.equal(event.senderFrame.url.startsWith('dsh-app://app/'), true) },
      applicationItems: () => [{ label: '应用' }], currentDesktopLocale: () => ({ messages: {} }),
      Menu: { buildFromTemplate: items => ({ popup: options => { popup = { items, ...options }; options.callback() } }) },
      shortcuts: { sendEditingKey() {} }, windowsLanguage: undefined,
    })
    if (platform === 'darwin') { assert.equal(menu, undefined); continue }
    const event = { sender: contents, senderFrame: frame }
    await menu(event, 'application', 10, 40)
    assert.equal(popup.x, 15)
    assert.equal(popup.y, 60)
    assert.equal(popup.window, window)
    await menu(event, 'edit', 10, 40)
    assert.ok(popup.items.length > 0)
    for (const invalid of [{ sender: {}, senderFrame: frame }, { sender: contents, senderFrame: { ...frame } }]) {
      assert.throws(() => menu(invalid, 'application', 0, 0), /rejected sender/)
    }
    for (const args of [['unknown', 0, 0], ['application', -1, 0], ['application', NaN, 0]]) {
      assert.throws(() => menu(event, ...args), /invalid popup/)
    }
    appearance(event, 'zh-CN', '#ffffff', 'rgb(0, 0, 0)')
    assert.equal(colors.color, '#ffffff')
    appearance(event, 'zh-CN', 'url(https://invalid)', '#000')
    appearance({ sender: {}, senderFrame: frame }, 'en', '#123', '#456')
    assert.equal(colors.color, '#ffffff')
  }
})

test('Linux preload enables the official caption layout before client mount', options, () => {
  const preload = stripTypeScriptTypes(source('preload-windows.ts')).replace(/^import.*$/mg, '').replace('export function', 'function')
  for (const platform of ['linux', 'win32', 'darwin']) {
    const properties = {}, listeners = [], root = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value } } }
    runInNewContext(preload + '\nsyncWindowsAppearance()', {
      process: { platform }, document: { documentElement: root, readyState: 'loading' },
      window: { addEventListener: (...args) => listeners.push(args) }, WINDOWS_TITLEBAR_HEIGHT: 40,
    })
    assert.equal(Object.hasOwn(root.dataset, 'windowsTitlebar'), platform !== 'darwin')
    assert.equal(properties['--dsh-windows-titlebar-height'], platform !== 'darwin' ? '40px' : undefined)
    assert.equal(listeners.length, platform !== 'darwin' ? 1 : 0)
  }
})

test('Linux fullscreen state reaches the document on transitions and after reload', options, () => {
  const main = source('main.ts')
  const start = main.indexOf("  if (process.platform === 'darwin' || process.platform === 'win32' || process.platform === 'linux') {")
  const send = stripTypeScriptTypes(main.slice(start, main.indexOf("\n  if (process.platform === 'darwin') {", start)))
  const listeners = {}, states = []
  let fullscreen = false, destroyed = false
  runInNewContext(send, {
    process: { platform: 'linux' }, DESKTOP_IPC: { windowFullscreen: 'fullscreen' },
    window: {
      on: (name, callback) => { listeners[name] = callback },
      isDestroyed: () => destroyed, isFullScreen: () => fullscreen,
      webContents: { on: (name, callback) => { listeners[name] = callback }, send: (_name, state) => states.push(state) },
    },
  })
  listeners['did-finish-load']()
  fullscreen = true
  listeners['enter-full-screen']()
  listeners['did-finish-load']()
  fullscreen = false
  listeners['leave-full-screen']()
  destroyed = true
  listeners['did-finish-load']()
  assert.deepEqual(states, [false, true, true, false])
  const preload = stripTypeScriptTypes(source('preload-platform.ts')).replace(/^import.*$/mg, '').replaceAll('export function', 'function')
  for (const platform of ['linux', 'win32', 'darwin', 'freebsd']) {
    let handler
    const root = { dataset: {} }
    runInNewContext(preload + '\nsyncWindowFullscreen()', {
      process: { platform }, document: { documentElement: root },
      ipcRenderer: { on: (_channel, listener) => { handler = listener } }, DESKTOP_IPC: { windowFullscreen: 'fullscreen' },
    })
    if (platform === 'freebsd') { assert.equal(handler, undefined); continue }
    handler({}, true)
    assert.equal(root.dataset.fullscreen, 'true')
    handler({}, false)
    assert.equal(Object.hasOwn(root.dataset, 'fullscreen'), false)
  }
})
