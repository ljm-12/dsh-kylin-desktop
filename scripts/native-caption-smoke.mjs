/** Exercise the adapted BrowserWindow and official caption CSS before a full build. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { patchLinuxTray } from './linux-tray-adapter.mjs'
import { patchLinuxWindow } from './linux-window-adapter.mjs'
import { dragCaption } from './caption-drag-smoke.mjs'

const electron = process.argv[2], upstream = process.env.DSH_TEST_SOURCE
assert.ok(electron && upstream && process.env.DISPLAY)
const scratch = mkdtempSync(join(tmpdir(), 'dsh-native-caption-'))
const manager = spawn('openbox', ['--sm-disable'], { stdio: 'ignore' })
let child, output = ''
try {
  let managerReady = false
  for (let attempt = 0; attempt < 100; attempt++) {
    managerReady = /window id # 0x[1-9a-f]/i.test(execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], { encoding: 'utf8' }))
    if (managerReady) break
    await delay(100)
  }
  assert.ok(managerReady, 'Openbox did not claim the virtual display')
  const original = readFileSync(join(upstream, 'apps/desktop/src/main.ts'), 'utf8')
  const main = patchLinuxWindow('apps/desktop/src/main.ts', patchLinuxTray(original))
  const start = main.indexOf('  const window = new BrowserWindow({')
  const create = stripTypeScriptTypes(main.slice(start, main.indexOf('\n  window.webContents.setWindowOpenHandler', start)))
  const css = readFileSync(join(upstream, 'packages/client/ui-layout/src/client/AppFrame.module.css'), 'utf8')
    .replace(/:global\(([^)]+)\)/g, '$1')
  const html = join(scratch, 'caption.html'), state = join(scratch, 'ready.json')
  writeFileSync(html, `<html data-windows-titlebar data-platform="linux" style="--dsh-windows-titlebar-height:40px;--dsw-specific-sidebar-fill:#f9fafb;--dsw-alias-bg-base:white"><head><style>
    html,body,#root{height:100%;margin:0}${css}
    </style></head><body><div id="root"><div class="frame" style="grid-template-columns:240px 1fr">
    <div class="sidebarCol">Sidebar</div><div class="centerCol">Workspace</div><div class="overlayLayer" data-shell-overlay></div>
    </div></div></body></html>`)
  mkdirSync(join(scratch, 'resources'))
  copyFileSync(join(upstream, 'apps/desktop/resources/icon-windows.png'), join(scratch, 'resources/icon-windows.png'))
  const fixture = join(scratch, 'app.cjs')
  writeFileSync(fixture, `const {app,BrowserWindow,nativeTheme}=require('electron');
    const {join}=require('node:path');const {writeFileSync}=require('node:fs');
    const WINDOWS_TITLEBAR_HEIGHT=40,chromeFallbackFill=()=> '#f9fafb';
    app.setPath('userData',${JSON.stringify(join(scratch, 'profile'))});
    app.whenReady().then(async()=>{
      const primary=true,show=true,preload=undefined;
      ${create}
      await window.loadFile(${JSON.stringify(html)});
      const caption=await window.webContents.executeJavaScript('JSON.stringify({visible:navigator.windowControlsOverlay.visible,rect:navigator.windowControlsOverlay.getTitlebarAreaRect().toJSON(),width:innerWidth})');
      writeFileSync(${JSON.stringify(state)},caption);
    });`)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(electron, ['--no-sandbox', '--disable-gpu', fixture], { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => { output += bytes })
  child.stderr.on('data', bytes => { output += bytes })
  for (let i = 0; i < 100 && !existsSync(state) && child.exitCode === null; i++) await delay(100)
  assert.ok(existsSync(state), `Native caption did not render: ${output}`)
  const caption = JSON.parse(readFileSync(state, 'utf8'))
  assert.equal(caption.visible, true)
  const x11 = args => execFileSync('xdotool', args, { encoding: 'utf8', timeout: 5000 })
  const window = x11(['search', '--onlyvisible', '--pid', String(child.pid)]).trim().split('\n')[0]
  const dragX = await dragCaption(window, caption.rect, x11)
  const width = caption.width - caption.rect.x - caption.rect.width
  const button = index => x11(['mousemove', '--window', window, String(Math.floor(caption.rect.x + caption.rect.width + width * (index + 0.5) / 3)), '20', 'click', '1'])
  const stateOfWindow = () => execFileSync('xprop', ['-id', window, '_NET_WM_STATE'], { encoding: 'utf8' })
  button(1)
  await delay(300)
  assert.match(stateOfWindow(), /_NET_WM_STATE_MAXIMIZED_VERT/)
  x11(['mousemove', '--window', window, String(dragX), '20', 'click', '--repeat', '2', '--delay', '100', '1'])
  await delay(300)
  assert.doesNotMatch(stateOfWindow(), /_NET_WM_STATE_MAXIMIZED_VERT/)
  button(0)
  await delay(300)
  assert.match(stateOfWindow(), /_NET_WM_STATE_HIDDEN/)
  x11(['windowmap', '--sync', window, 'windowactivate', '--sync', window])
  button(2)
  for (let i = 0; i < 50 && child.exitCode === null; i++) await delay(100)
  assert.equal(child.exitCode, 0, `Native close did not exit: ${output}`)
  console.log('Native caption smoke passed: official caption CSS + Linux overlay + drag/maximize/restore/minimize/close', JSON.stringify(caption))
} finally {
  manager.kill()
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
  rmSync(scratch, { recursive: true, force: true })
}
