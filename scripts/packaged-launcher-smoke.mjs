/** Launch the actual installed entrypoint and official main process in a disposable profile. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const [app] = process.argv.slice(2)
assert.ok(app, 'packaged app path required')
assert.ok(process.env.DISPLAY && process.env.XAUTHORITY, 'Run this smoke test inside xvfb-run so application and window tools share X11 credentials')
execFileSync('xdotool',['getdisplaygeometry'],{stdio:'ignore',timeout:5000})
// Electron does not implement CDP Browser window controls. Use a real X11
// window manager; all test processes inherit the same xvfb-run credentials.
const windowManager = spawn('openbox',['--sm-disable'],{stdio:'ignore'})
let windowManagerError
windowManager.on('error',error=>{windowManagerError=error})
const scratch = mkdtempSync(join(tmpdir(), 'dsh-installed-startup-'))
assert.ok(process.env.DBUS_SESSION_BUS_ADDRESS, 'Run inside an isolated dbus-run-session')
const trayRegistry = join(scratch, 'tray.json')
const trayProbe = fileURLToPath(new URL('./tray-session-probe.py', import.meta.url))
const trayHost = spawn('/usr/bin/python3', [trayProbe, 'watch', trayRegistry], { stdio: ['ignore', 'ignore', 'pipe'] })
let trayHostError = ''
trayHost.stderr.on('data', bytes => { trayHostError += bytes })
for (let attempt = 0; attempt < 50 && !existsSync(trayRegistry); attempt++) await delay(100)
assert.ok(existsSync(trayRegistry), `StatusNotifier host failed: ${trayHostError}`)
const trayAction = action => execFileSync('/usr/bin/python3', [trayProbe, action, trayRegistry], { encoding: 'utf8', timeout: 5000 })
for (const directory of ['config','cache','state','run']) mkdirSync(join(scratch,directory), { mode:0o700 })
const diagnostic = join(scratch, 'startup-error.txt')
const server = createServer()
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
await new Promise(resolve => server.close(resolve))
let output = '', socket, sequence = 0
const pending = new Map()
const transports = { opened:0, closed:0, errors:0, frames:0, events:0, eventClosed:0, eventErrors:0, replies:0, navigations:0 }
const websocketRequests = new Set()
const eventRequests = new Set()
let workspaceSession, observing = false
const environment = {...process.env, DSH_HOME:join(scratch,'home'),
  XDG_CONFIG_HOME:join(scratch,'config'), XDG_CACHE_HOME:join(scratch,'cache'),
  XDG_STATE_HOME:join(scratch,'state'), XDG_RUNTIME_DIR:join(scratch,'run'),
  DSH_DESKTOP_DIAGNOSTIC_FILE:diagnostic, NODE_OPTIONS:''}
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(join(app,'deepseek-harness-kylin'), [
  // Sandbox opt-out applies only to this extracted CI package, before postinst runs.
  '--no-sandbox', '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`,
  `--user-data-dir=${join(scratch,'electron')}`], {
  detached:true,
  env:environment,
  stdio:['ignore','pipe','pipe'],
})
child.stdout.on('data', bytes => { output = (output + bytes).slice(-16000) })
child.stderr.on('data', bytes => { output = (output + bytes).slice(-16000) })
let spawnError
child.on('error', error => { spawnError = error })
function checkAlive() {
  if (spawnError) throw spawnError
  if (windowManagerError) throw windowManagerError
  assert.equal(windowManager.exitCode,null,'X11 window manager exited before desktop qualification')
  assert.equal(trayHost.exitCode,null,`StatusNotifier host exited: ${trayHostError}`)
  assert.equal(child.exitCode, null, `Installed desktop exited early: ${output}`)
  assert.equal(child.signalCode, null, `Installed desktop terminated early: ${output}`)
  try { throw new Error('Official desktop startup failed: ' + readFileSync(diagnostic,'utf8')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
async function command(method, params = {}, sessionId) {
  const id = ++sequence
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) },10000)
    pending.set(id,{resolve,reject,timer})
    socket.send(JSON.stringify({id,method,params,...(sessionId ? {sessionId} : {})}))
  })
}
try {
  let debuggerUrl
  for (let attempt=0; attempt<30; attempt++) {
    checkAlive()
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal:AbortSignal.timeout(1000)})
      debuggerUrl = (await response.json()).webSocketDebuggerUrl
    } catch { /* Debug endpoint is still starting. */ }
    if (debuggerUrl) break
    await delay(1000)
  }
  assert.ok(debuggerUrl, `Official main process did not start its debug endpoint: ${output}`)
  socket = new WebSocket(debuggerUrl)
  await new Promise((resolve,reject) => {
    const timer = setTimeout(() => reject(new Error('CDP socket did not open')),10000)
    socket.addEventListener('open', () => {clearTimeout(timer);resolve()}, {once:true})
    socket.addEventListener('error', error => {clearTimeout(timer);reject(error)}, {once:true})
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const request = pending.get(message.id)
    if (!request) {
      if (message.sessionId !== workspaceSession) return
      const details = message.params ?? {}
      if (message.method === 'Network.requestWillBeSent' && details.request?.url?.endsWith('/plugins/events')) eventRequests.add(details.requestId)
      if (eventRequests.has(details.requestId)) {
        if (message.method === 'Network.loadingFailed') transports.eventErrors++
        if (message.method === 'Network.loadingFinished') transports.eventClosed++
      }
      if (message.method === 'Network.webSocketCreated' && details.url?.endsWith('/api/remote.mux')) {
        websocketRequests.add(details.requestId)
      }
      if (websocketRequests.has(details.requestId)) {
        if (message.method === 'Network.webSocketHandshakeResponseReceived') transports.opened++
        if (message.method === 'Network.webSocketClosed') transports.closed++
        if (message.method === 'Network.webSocketFrameError') transports.errors++
        if (message.method === 'Network.webSocketFrameReceived') transports.frames++
      }
      if (message.method === 'Network.eventSourceMessageReceived') transports.events++
      if (message.method === 'Network.responseReceived' && details.response?.url?.startsWith('dsh-app://app/api/') && details.response.status === 200) transports.replies++
      if (message.method === 'Page.frameNavigated' && !details.frame.parentId && observing) transports.navigations++
      return
    }
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.reject(new Error(JSON.stringify(message.error)))
    else request.resolve(message.result)
  })
  let state
  const sessions = new Map()
  let observations = []
  // The official shell initially creates a hidden main page and can then open
  // a visible welcome window. Re-discover targets rather than fixing the first page.
  for (let attempt=0; attempt<90; attempt++) {
    checkAlive()
    observations = []
    const {targetInfos} = await command('Target.getTargets')
    const pages = targetInfos.filter(item => item.type === 'page' &&
      (item.url === 'dsh-app://app/' || (item.url.startsWith('file://') && item.url.endsWith('/renderer/welcome.html'))))
    for (const page of pages) {
      let sessionId = sessions.get(page.targetId)
      if (!sessionId) {
        sessionId = (await command('Target.attachToTarget',{targetId:page.targetId,flatten:true})).sessionId
        sessions.set(page.targetId,sessionId)
      }
      const result = await command('Runtime.evaluate', {expression:
        'JSON.stringify({url:location.href,ready:document.readyState,visible:document.visibilityState,text:document.body?.innerText.length??0,buttons:document.querySelectorAll("button").length})', returnByValue:true}, sessionId)
      assert.ok(!result.exceptionDetails, 'Unable to inspect official window')
      const candidate = JSON.parse(result.result.value)
      observations.push(candidate)
      if (candidate.ready === 'complete' && candidate.visible === 'visible' && candidate.text > 30 && candidate.buttons > 0) {
        state = candidate
        break
      }
    }
    if (state) break
    await delay(1000)
  }
  assert.ok(state, `Official main did not display rendered controls: ${JSON.stringify(observations)}\n${output}`)
  // The welcome window is only onboarding. Exercise its official Skip action,
  // then qualify the actual workspace rather than accepting welcome as GUI health.
  if (state.url.startsWith('file://')) {
    const welcome = observations.find(item => item.url === state.url)
    const {targetInfos} = await command('Target.getTargets')
    const target = targetInfos.find(item => item.url === welcome.url)
    // Skip closes this window. Do not await a promise in the context it destroys.
    await command('Runtime.evaluate', {expression:'setTimeout(() => void window.dshWelcome.skip(), 0); true'}, sessions.get(target.targetId))
  }
  const {targetInfos} = await command('Target.getTargets')
  const main = targetInfos.find(item => item.type === 'page' && item.url === 'dsh-app://app/')
  assert.ok(main, 'Official workspace target missing')
  workspaceSession = sessions.get(main.targetId) ?? (await command('Target.attachToTarget',{targetId:main.targetId,flatten:true})).sessionId
  await command('Network.enable', {}, workspaceSession)
  await command('Page.enable', {}, workspaceSession)
  // Begin observation before one intentional document load, so no first socket
  // is missed while the fresh-profile welcome dialog is selected.
  await command('Page.reload', {}, workspaceSession)
  let initial
  for (let attempt=0; attempt<30; attempt++) {
    checkAlive()
    const result = await command('Runtime.evaluate', {expression:
      'JSON.stringify({ready:document.readyState,visible:document.visibilityState,text:document.body?.innerText.length??0,timeOrigin:performance.timeOrigin})',returnByValue:true}, workspaceSession)
    initial = JSON.parse(result.result.value)
    if (initial.ready === 'complete' && initial.visible === 'visible' && initial.text > 100 && transports.opened > 0 && transports.frames > 0 && transports.events > 0) break
    await delay(1000)
  }
  assert.ok(initial?.text > 100 && transports.opened > 0 && transports.events > 0, `Workspace did not connect: ${JSON.stringify({initial,transports})}\n${output}`)
  observing = true
  // The installed launcher execs Electron, so its spawn PID owns the X11 window.
  assert.ok(child.pid > 0, 'Installed desktop process did not start')
  const x11 = args => execFileSync('xdotool',args,{encoding:'utf8',timeout:5000})
  const windows = x11(['search','--onlyvisible','--pid',String(child.pid)]).trim().split('\n')
  assert.equal(windows.length,1,'Expected exactly one visible official workspace window')
  assert.match(windows[0],/^\d+$/,'Invalid native X11 window ID')
  const windowId = windows[0]
  const captionResult = await command('Runtime.evaluate', { expression: `JSON.stringify((() => {
    const root = document.documentElement;
    const overlay = navigator.windowControlsOverlay;
    const rect = overlay?.getTitlebarAreaRect();
    const menu = document.querySelector('[data-windows-menu]');
    const buttons = Array.from(menu?.shadowRoot?.querySelectorAll('button') ?? []);
    return { platform: root.dataset.platform, caption: root.hasAttribute('data-windows-titlebar'),
      height: root.style.getPropertyValue('--dsh-windows-titlebar-height'),
      overlay: overlay?.visible, rect: rect?.toJSON(), width: innerWidth,
      menus: buttons.map(button => ({ text: button.textContent, y: button.getBoundingClientRect().y,
        bottom: button.getBoundingClientRect().bottom })) };
  })())`, returnByValue: true }, workspaceSession)
  assert.ok(!captionResult.exceptionDetails, 'Unable to inspect integrated caption')
  const caption = JSON.parse(captionResult.result.value)
  assert.equal(caption.platform, 'linux')
  assert.equal(caption.caption, true)
  assert.equal(caption.height, '40px')
  assert.equal(caption.overlay, true, 'Native window buttons are missing')
  assert.equal(caption.rect.y, 0)
  assert.ok(caption.rect.height > 0 && caption.rect.height <= 40)
  assert.equal(caption.menus.length, 2, 'Integrated application/edit menus are missing')
  assert.ok(caption.menus.every(item => item.text && item.y >= 0 && item.bottom <= 40), 'Menus escaped the caption row')
  const decorations = execFileSync('xprop', ['-id', windowId, '_MOTIF_WM_HINTS'], { encoding: 'utf8' })
  const hints = decorations.match(/=\s*(0x[\da-f]+|\d+),\s*(0x[\da-f]+|\d+),\s*(0x[\da-f]+|\d+)/i)
  assert.ok(hints && (Number(hints[1]) & 2) !== 0 && Number(hints[3]) === 0, 'System titlebar still decorates the workspace')
  const geometry = () => Object.fromEntries(x11(['getwindowgeometry', '--shell', windowId]).trim().split('\n')
    .map(line => line.split('=')).map(([key, value]) => [key, Number(value)]))
  const beforeDrag = geometry()
  const dragX = Math.floor(caption.rect.x + caption.rect.width / 2)
  x11(['mousemove', '--window', windowId, String(dragX), '20', 'mousedown', '1'])
  x11(['mousemove', '--sync', String(beforeDrag.X + dragX + 48), String(beforeDrag.Y + 52)])
  x11(['mouseup', '1'])
  await delay(300)
  const afterDrag = geometry()
  assert.ok(afterDrag.X !== beforeDrag.X || afterDrag.Y !== beforeDrag.Y, 'Integrated caption cannot drag the window')
  // Electron draws the Linux caption buttons to the right of its exposed safe area.
  const controlsWidth = caption.width - caption.rect.x - caption.rect.width
  assert.ok(controlsWidth > 0 && controlsWidth < 200, 'Window controls have no usable right-hand area')
  const nativeButton = index => x11(['mousemove', '--window', windowId,
    String(Math.floor(caption.rect.x + caption.rect.width + controlsWidth * (index + 0.5) / 3)), '20', 'click', '1'])
  nativeButton(1)
  await delay(300)
  assert.match(execFileSync('xprop', ['-id', windowId, '_NET_WM_STATE'], { encoding: 'utf8' }), /_NET_WM_STATE_MAXIMIZED_VERT/,
    'Integrated maximize button did not maximize')
  // Restore through the titlebar double-click before using the original geometry again.
  x11(['mousemove', '--window', windowId, String(dragX), '20', 'click', '--repeat', '2', '--delay', '100', '1'])
  await delay(300)
  assert.doesNotMatch(execFileSync('xprop', ['-id', windowId, '_NET_WM_STATE'], { encoding: 'utf8' }), /_NET_WM_STATE_MAXIMIZED_VERT/)
  nativeButton(0)
  await delay(300)
  const minimized = await command('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, workspaceSession)
  assert.equal(minimized.result.value, 'hidden', 'Integrated minimize button did not minimize')
  trayAction('activate')
  await delay(300)
  console.log('Installed integrated caption ready:', JSON.stringify(caption))
  const icon = execFileSync('xprop', ['-id', windowId, '-len', '64', '_NET_WM_ICON'], { encoding: 'utf8' })
  assert.doesNotMatch(icon, /not found|no such atom/, 'Workspace did not publish its taskbar icon')
  const windowState = execFileSync('xprop', ['-id', windowId, '_NET_WM_STATE'], { encoding: 'utf8' })
  assert.doesNotMatch(windowState, /_NET_WM_STATE_SKIP_TASKBAR/, 'Workspace is hidden from the taskbar')
  const tray = JSON.parse(trayAction('info'))
  assert.equal(tray.status, 'Active', 'Tray is not active')
  assert.equal(tray.icon, true, 'Tray has no usable icon')
  assert.equal(tray.entries.length, 2, 'Expected the show and quit tray entries')
  assert.ok(tray.entries.every(entry => entry.label && entry.enabled && entry.visible), 'Tray entries are not usable')
  console.log('Installed tray ready:', JSON.stringify(tray))
  for (let sample=0; sample<12; sample++) {
    // Include background/foreground transitions that the isolated fixture omitted.
    if (sample === 1) x11(['windowminimize',windowId])
    if (sample === 2) {x11(['windowmap','--sync',windowId]);x11(['windowactivate','--sync',windowId])}
    if (sample === 3) {
      x11(['windowactivate','--sync',windowId])
      x11(['key','--clearmodifiers','alt+F4'])
    }
    if (sample === 5) trayAction('activate')
    await delay(5000)
    checkAlive()
    const result = await command('Runtime.evaluate',{expression:'performance.timeOrigin',returnByValue:true},workspaceSession)
    assert.equal(result.result.value,initial.timeOrigin,'Workspace document unexpectedly reloaded')
    const visibility = await command('Runtime.evaluate',{expression:'document.visibilityState',returnByValue:true},workspaceSession)
    assert.equal(visibility.result.value,sample===1 || sample===3 || sample===4 ? 'hidden' : 'visible','Window minimize/close and tray restore did not take effect')
    assert.equal(transports.navigations,0,'Workspace unexpectedly navigated')
    assert.equal(transports.closed,0,'Workspace Remote mux closed')
    assert.equal(transports.errors,0,'Workspace Remote mux errored')
    assert.equal(transports.eventClosed,0,'Workspace plugin event stream ended')
    assert.equal(transports.eventErrors,0,'Workspace plugin event stream failed')
    console.log('Installed workspace sample:',JSON.stringify({seconds:(sample+1)*5,...transports}))
  }
  assert.equal(transports.opened,1,'Workspace repeatedly replaced its Remote mux')
  assert.ok(transports.replies > 0,'Workspace never received API replies')
  assert.equal(existsSync(join(app,'resources/transport-diagnostics.cjs')),false,'Temporary diagnostic observer remains in the package')
  x11(['windowactivate','--sync',windowId])
  nativeButton(2)
  await delay(500)
  const closed = await command('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true }, workspaceSession)
  assert.equal(closed.result.value, 'hidden', 'Integrated close button did not hide the workspace to tray')
  trayAction('open')
  await delay(500)
  const restored = await command('Runtime.evaluate', {expression:'document.visibilityState',returnByValue:true}, workspaceSession)
  assert.equal(restored.result.value, 'visible', 'Show menu did not restore the workspace')
  trayAction('quit')
  for (let attempt = 0; attempt < 30 && child.exitCode === null; attempt++) await delay(500)
  assert.equal(child.exitCode, 0, `Tray Quit did not stop the app cleanly: ${output}`)
  let groupExited = false
  for (let attempt = 0; attempt < 15; attempt++) {
    try { process.kill(-child.pid, 0) }
    catch (error) { if (error.code !== 'ESRCH') throw error; groupExited = true; break }
    await delay(200)
  }
  assert.ok(groupExited, 'Tray Quit left a live desktop/Host process behind')
  const { readdirSync, readlinkSync } = await import('node:fs')
  const remaining = []
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    try {
      const executable = readlinkSync(`/proc/${pid}/exe`)
      const env = readFileSync(`/proc/${pid}/environ`)
      if (executable.startsWith(app + '/') || env.includes(Buffer.from(`DSH_HOME=${join(scratch, 'home')}\0`))) remaining.push(pid)
    } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error }
  }
  assert.deepEqual(remaining, [], 'Tray Quit left detached desktop/Host workers behind')
  console.log('Installed launcher smoke passed: integrated caption + drag/maximize/minimize/close + CA + taskbar icon + StatusNotifier tray + click/menu restore + graceful menu quit + 60s mux/SSE', JSON.stringify(transports))
} catch (error) { console.error(output); throw error }
finally {
  windowManager.kill()
  trayHost.kill()
  socket?.close()
  for (const request of pending.values()) clearTimeout(request.timer)
  try { process.kill(-child.pid,'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
  await delay(1000)
  try { process.kill(-child.pid,'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  rmSync(scratch,{recursive:true,force:true})
}
