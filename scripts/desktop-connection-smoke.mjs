/** Exercise the built official page, its real Host, HMR SSE and Remote mux together. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, ipcMain, protocol, session } from 'electron'

const source = process.env.DSH_SOURCE_DIR
const scratch = process.env.DSH_TRANSPORT_SCRATCH
const target = join(source, 'apps/desktop/.desktop-build/targets/linux-arm64')
const packaged = process.env.DSH_PACKAGED_APP
const runtime = packaged ? join(packaged, 'resources/app.asar/dsh') : join(target, 'dsh')
const resourcesRuntime = packaged ? join(packaged, 'resources/runtime') : join(target, 'runtime')
const hostExecutable = packaged ? join(packaged, 'deepseek-harness-kylin.bin') : process.execPath
const compiled = join(source, 'apps/desktop/lib/types')
app.setPath('userData', join(scratch, 'electron'))
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])

// Observation runs before the real page boot. Keep its browser transports intact.
const observation = `<script>
globalThis.__transportObservation = { wsOpen:0, wsClose:[], wsItems:0, sseOpen:0, sseError:0 };
const observed = globalThis.__transportObservation;
globalThis.WebSocket = class extends WebSocket {
  constructor(...args) {
    super(...args);
    this.addEventListener('open', () => observed.wsOpen++);
    this.addEventListener('close', event => observed.wsClose.push({code:event.code,reason:event.reason}));
    this.addEventListener('message', () => observed.wsItems++);
  }
};
globalThis.EventSource = class extends EventSource {
  constructor(...args) {
    super(...args);
    if (new URL(args[0], location.href).pathname !== '/plugins/events') return;
    this.addEventListener('open', () => observed.sseOpen++);
    this.addEventListener('error', () => observed.sseError++);
  }
};
</script>`
let window, host, fatal
let apiReplies = 0
let servedOfficialClient = false
const connectionErrors = []
const deadline = setTimeout(() => { console.error('Official page connection smoke timed out'); app.exit(1) }, 210000)

async function run() {
  try {
    await app.whenReady()
    const load = file => import(pathToFileURL(join(compiled, file)).href)
    const [{ DesktopHostProcess }, { createPluginProfile }, web] = await Promise.all([
      load('host-process.js'), load('project-manager.js'), load('web-document.js'),
    ])
    const client = readFileSync(join(runtime, 'node_modules/@deepseek-ai/dsh-client-connection/lib/client.js'), 'utf8')
    assert.doesNotMatch(client, /generation source failed:|stableGenerationMs/, 'custom Connection code must not be packaged')
    assert.equal(client, readFileSync(join(source, 'packages/client/connection/lib/client.js'), 'utf8'), 'packaged Connection differs from official compilation')
    console.log('Official page connection smoke: official compiled client verified')
    const profile = join(scratch, 'home/profiles/desktop')
    createPluginProfile(profile)
    writeFileSync(join(profile, 'cordis.patch.yml'), '- id: webserver\n  config:\n    host: 127.0.0.1\n    port: 0\n')
    host = new DesktopHostProcess(hostExecutable, runtime, profile, undefined,
      { ...process.env, DSH_HOME: join(scratch, 'home'), NODE_OPTIONS: '' },
      error => { fatal = error }, join(resourcesRuntime, 'primary-runtime'),
      { pnpm: join(resourcesRuntime, 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs'), nodeBin: join(resourcesRuntime, 'bin') })
    const ready = await host.start()
    const origin = new URL(ready.url).origin
    const cookie = await web.authenticateWebHost(ready.url)
    console.log('Official page connection smoke: real Host ready', packaged ? 'final ASAR payload' : 'materialized payload')
    const preload = join(scratch, 'boot.cjs')
    writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('dshDesktopBoot', {
  ready:()=>ipcRenderer.invoke('connection-smoke:boot'),
  failed:message=>ipcRenderer.invoke('connection-smoke:failed',message)
});`)
    ipcMain.handle('connection-smoke:boot', () => ({ injections: ready.injections ?? [], streamBaseUrl: origin }))
    ipcMain.handle('connection-smoke:failed', (_event, message) => { fatal = new Error(message) })
    protocol.handle('dsh-app', async request => {
      const url = new URL(request.url)
      if (url.hostname !== 'app') return new Response(null, { status:403 })
      if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/assets/')
        || ['/favicon.svg','/manifest.webmanifest'].includes(url.pathname)) {
        const reply = await web.serveWebDocument(request, join(runtime, 'node_modules/@deepseek-ai/dsh-web-frontend/dist'))
        if (url.pathname !== '/') return reply
        return new Response((await reply.text()).replace('<head>', '<head>' + observation), { headers:reply.headers })
      }
      const reply = await web.forwardWebRequest(request, origin, cookie)
      if (url.pathname.startsWith('/api/') && reply.status === 200) apiReplies++
      if (url.pathname.startsWith('/plugins/') && /javascript/.test(reply.headers.get('content-type') ?? '')) {
        void reply.clone().text().then(code => {
          if (code.includes('connection lost, retry #')) {
            assert.doesNotMatch(code, /generation source failed:/)
            servedOfficialClient = true
          }
        }).catch(error => { fatal = error })
      }
      return reply
    })
    session.defaultSession.webRequest.onBeforeSendHeaders({urls:['ws://127.0.0.1/*']}, (details, callback) => {
      if (details.webContentsId !== window?.webContents.id || new URL(details.url).origin.replace('ws:', 'http:') !== origin) {
        callback({cancel:true}); return
      }
      const headers = Object.fromEntries(Object.entries(details.requestHeaders).map(([key,value]) => [key.toLowerCase(),value]))
      if (headers.origin !== 'dsh-app://app') { callback({cancel:true}); return }
      callback({requestHeaders:{...headers,origin,cookie,'sec-fetch-site':'same-origin'}})
    })
    window = new BrowserWindow({ show:true, webPreferences: {
      preload, sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false,
    } })
    window.webContents.on('console-message', (details) => {
      const message = details.message
      if (typeof message === 'string' && message.includes('[connection]')) {
        connectionErrors.push(message)
        console.error('Official page connection:', message)
      }
    })
    await window.loadURL('dsh-app://app/')
    for (let sample = 0; sample < 12; sample++) {
      await new Promise(resolve => setTimeout(resolve,5000))
      if (fatal) throw fatal
      const state = await window.webContents.executeJavaScript('globalThis.__transportObservation')
      console.log('Official page connection sample:', JSON.stringify({seconds:(sample+1)*5,apiReplies,servedOfficialClient,...state}))
      assert.equal(connectionErrors.length,0,'real page entered connection recovery')
      assert.equal(state.wsClose.length,0,'Remote mux closed during observation')
      assert.equal(state.sseError,0,'plugin EventSource failed during observation')
      if (sample === 11) {
        assert.equal(state.wsOpen,1,'expected one sustained Remote mux')
        assert.ok(state.wsItems > 0,'Remote mux never delivered its readiness frame')
        assert.equal(state.sseOpen,1,'expected one sustained plugin EventSource')
        assert.ok(apiReplies > 0,'real page did not load Host APIs')
        assert.ok(servedOfficialClient,'real page did not receive the official Connection client')
      }
    }
    writeFileSync(join(scratch, 'passed.json'), JSON.stringify({ servedOfficialClient, apiReplies }))
    console.log('Official page connection smoke passed: real Host + official frontend + 60s Remote mux and plugin SSE')
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    clearTimeout(deadline)
    window?.destroy()
    await host?.stop()
    app.exit(process.exitCode ?? 0)
  }
}
void run()
