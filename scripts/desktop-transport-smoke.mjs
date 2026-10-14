/** Real Electron renderer/protocol/HTTP transport qualification; no user profile or model calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { app, BrowserWindow, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

app.setPath('userData', process.env.DSH_TRANSPORT_SCRATCH)
app.on('window-all-closed', () => {})
protocol.registerSchemesAsPrivileged([{ scheme: 'dsh-app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }])
const timers = new Set()
let calls = 0
const server = createServer(async (request, response) => {
  if (request.headers.cookie !== 'session=transport-test') { response.writeHead(403).end(); return }
  if (request.url === '/events') {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: ready\n\n')
    const timer = setInterval(() => response.write('data: tick\n\n'), 100)
    timers.add(timer)
    response.on('close', () => { clearInterval(timer); timers.delete(timer) })
    return
  }
  let body = ''
  for await (const chunk of request) body += chunk
  calls++
  const { sequence } = JSON.parse(body)
  const bytes = gzipSync(JSON.stringify({ sequence, payload: '测试 response '.repeat(10000) }))
  response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip',
    'content-length': bytes.byteLength, 'set-cookie': 'must-not-reach-renderer' })
  // Exercise real compressed, delayed body delivery rather than a mocked fetch.
  response.write(bytes.subarray(0, 15))
  setTimeout(() => response.end(bytes.subarray(15)), 40)
})
let window
const timeout = setTimeout(() => { console.error('Desktop transport smoke timed out'); app.exit(1) }, 45000)
// Keep entrypoint evaluation independent of app readiness to avoid an ESM
// startup wait cycle when this fixture is launched directly by Electron.
async function run() {
  try {
    console.log('Desktop transport smoke: waiting for Electron ready')
    await app.whenReady()
    console.log('Desktop transport smoke: Electron ready')
    const { forwardWebRequest } = await import(pathToFileURL(process.env.DSH_WEB_DOCUMENT).href)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    protocol.handle('dsh-app', request => new URL(request.url).pathname === '/'
      ? new Response('<html><body>isolated transport qualification</body></html>', { headers: { 'content-type': 'text/html' } })
      : forwardWebRequest(request, origin, 'session=transport-test'))
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
    window.webContents.on('console-message', (_event, details) => console.log('Transport renderer:', details.message))
    window.webContents.on('render-process-gone', (_event, details) => console.error('Transport renderer exited:', details.reason))
    await window.loadURL('dsh-app://app/')
    console.log('Desktop transport smoke: renderer loaded')
    const result = await window.webContents.executeJavaScript(`(async () => {
      const abort = new AbortController();
      const response = await fetch('/events', { signal: abort.signal });
      console.log('event stream opened');
      const reader = response.body.getReader();
      let ticks = 0;
      const reading = (async () => { try { while (!(await reader.read()).done) ticks++; } catch (error) { if (!abort.signal.aborted) throw error; } })();
      try {
        for (let sequence=0; sequence<40; sequence++) {
          const reply = await fetch('/api/session/modelCatalog', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({sequence}) });
          if (reply.status !== 200) throw new Error('RPC status ' + reply.status);
          if (reply.headers.get('set-cookie') !== null || reply.headers.get('content-encoding') !== null) throw new Error('withheld headers leaked');
          const data = await reply.json();
          if (data.sequence !== sequence || data.payload !== '测试 response '.repeat(10000)) throw new Error('response body mismatch');
          if (sequence % 10 === 9) console.log('complete RPC replies: ' + (sequence + 1));
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (ticks < 60) throw new Error('event stream did not remain live');
        return { replies:40, ticks };
      } finally { abort.abort(); await reading; }
    })()`)
    assert.equal(result.replies, 40)
    assert.equal(calls, 40)
    writeFileSync(join(process.env.DSH_TRANSPORT_SCRATCH, 'passed.json'), JSON.stringify(result))
    console.log('Desktop transport smoke passed:', JSON.stringify({ electron: process.versions.electron,
      platform: process.platform, arch: process.arch, ...result }))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally {
    clearTimeout(timeout)
    window?.destroy()
    for (const timer of timers) clearInterval(timer)
    server.closeAllConnections()
    server.close()
    app.exit(process.exitCode ?? 0)
  }
}
void run()
