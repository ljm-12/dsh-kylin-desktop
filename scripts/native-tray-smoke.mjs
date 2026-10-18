/** Qualify the real Electron tray before the full desktop build. */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { stripTypeScriptTypes } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
import { patchLinuxTray } from './linux-tray-adapter.mjs'

const electron = process.argv[2]
const upstream = process.env.DSH_TEST_SOURCE
assert.ok(electron && upstream && process.env.DISPLAY && process.env.DBUS_SESSION_BUS_ADDRESS)
assert.ok(existsSync(electron), `Electron binary was not downloaded: ${electron}`)
const scratch = mkdtempSync(join(tmpdir(), 'dsh-native-tray-'))
const registry = join(scratch, 'tray.json'), state = join(scratch, 'window.json')
const probe = fileURLToPath(new URL('./tray-session-probe.py', import.meta.url))
const manager = spawn('openbox', ['--sm-disable'], { stdio: 'ignore' })
const watcher = spawn('/usr/bin/python3', [probe, 'watch', registry], { stdio: ['ignore', 'ignore', 'pipe'] })
let output = '', child
watcher.stderr.on('data', bytes => { output += bytes })
const action = name => execFileSync('/usr/bin/python3', [probe, name, registry], { encoding: 'utf8', timeout: 8000 })
async function until(condition, description) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await delay(100)
  }
  throw new Error(`${description}: ${output}`)
}
try {
  await until(() => existsSync(registry), 'Tray watcher did not start')
  await until(() => /window id # 0x[1-9a-f]/i.test(execFileSync('xprop', ['-root', '_NET_SUPPORTING_WM_CHECK'], { encoding: 'utf8' })),
    'Openbox did not claim the virtual display')
  const tray = stripTypeScriptTypes(readFileSync(join(upstream, 'apps/desktop/src/tray.ts'), 'utf8'), { mode: 'transform' })
    .replace(/^import.*$/mg, '').replace('export class', 'class')
  const main = patchLinuxTray(readFileSync(join(upstream, 'apps/desktop/src/main.ts'), 'utf8'))
  const start = main.indexOf("    window.on('close', (event) => {")
  const close = stripTypeScriptTypes(main.slice(start, main.indexOf("\n    if (process.platform === 'win32') {", start)))
  const cleanup = stripTypeScriptTypes(readFileSync(new URL('../build/kylin-process-tree.ts', import.meta.url), 'utf8'), { mode: 'transform' })
    .replace(/^import.*$/mg, '').replace('export class', 'class')
  const fixture = join(scratch, 'app.cjs')
  writeFileSync(fixture, `const {app,BrowserWindow,Menu,nativeImage,Tray}=require('electron');
const {writeFileSync,renameSync,readFileSync,readdirSync,readlinkSync}=require('node:fs');
const {dirname,join}=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
${cleanup}
const ownedProcesses=new KylinProcessTree();
${tray}
app.setPath('userData',${JSON.stringify(join(scratch, 'profile'))});
let quitting=false,tray;
app.whenReady().then(()=>{
 const window=new BrowserWindow({title:'Kylin tray qualification',width:500,height:300,icon:${JSON.stringify(join(upstream,'apps/desktop/resources/icon-windows.png'))}});
 const publish=()=>{writeFileSync(${JSON.stringify(state + '.tmp')},JSON.stringify({visible:window.isVisible()}));renameSync(${JSON.stringify(state + '.tmp')},${JSON.stringify(state)});};
 const shellInstallerOwnsQuit=false,sessionEnding=false,backgroundNotice=undefined;
 const updateDialog={isOpen:false};const hideMainWindow=window=>window.hide();
 tray=new DesktopTray({iconPath:${JSON.stringify(join(upstream,'apps/desktop/resources/icon-windows.png'))},
 locale:()=>({messages:{aboutProduct:'Tray qualification',openApplication:'Show',quitApplication:'Quit'}}),
 open:()=>{window.show();window.focus();},quit:()=>setTimeout(()=>app.quit(),20)});
 ${close}
 window.on('hide',publish);window.on('show',publish);
 window.loadURL('data:text/html,<title>Kylin tray qualification</title><h1>Native tray qualification</h1>').then(publish);
});
app.on('before-quit',event=>{if(quitting)return;event.preventDefault();quitting=true;tray?.dispose();
console.log('Native cleanup candidates',JSON.stringify(ownedProcesses.capture().map(item=>({pid:item.pid,exe:readlinkSync('/proc/'+item.pid+'/exe'),args:readFileSync('/proc/'+item.pid+'/cmdline','utf8')}))));
ownedProcesses.stop().then(()=>app.quit(),()=>app.exit(1));});
`)
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  child = spawn(electron, ['--no-sandbox', '--disable-gpu', fixture], { env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', bytes => { output += bytes })
  child.stderr.on('data', bytes => { output += bytes })
  await until(() => existsSync(state) && JSON.parse(readFileSync(registry)).items.length > 0, 'Native tray did not register')
  const info = JSON.parse(action('info'))
  assert.equal(info.status, 'Active')
  assert.equal(info.icon, true)
  assert.deepEqual(info.entries.map(entry => entry.label), ['Show', 'Quit'])
  const window = execFileSync('xdotool', ['search', '--all', '--onlyvisible', '--pid', String(child.pid), '--name', '^Kylin tray qualification$'], { encoding: 'utf8' }).trim().split('\n')[0]
  const closeWindow = async () => {
    execFileSync('xdotool', ['windowactivate', '--sync', window])
    await delay(200)
    execFileSync('xdotool', ['key', '--clearmodifiers', 'alt+F4'])
  }
  await closeWindow()
  await until(() => !JSON.parse(readFileSync(state)).visible, 'Window did not hide')
  assert.equal(child.exitCode, null)
  action('activate')
  await until(() => JSON.parse(readFileSync(state)).visible, 'Tray activation did not restore the window')
  await closeWindow()
  await until(() => !JSON.parse(readFileSync(state)).visible, 'Second close did not hide')
  action('open')
  await until(() => JSON.parse(readFileSync(state)).visible, 'Show menu did not restore the window')
  action('quit')
  await until(() => child.exitCode !== null, 'Quit menu did not stop Electron')
  assert.equal(child.exitCode, 0)
  console.log('Native Electron tray smoke passed: strict UKUI registration, unique-owner calls, icon, close/hide, activation, Show, Quit', JSON.stringify(info))
} finally {
  watcher.kill(); manager.kill()
  if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
  rmSync(scratch, { recursive: true, force: true })
}
