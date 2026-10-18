import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyOfficialSource } from './verify-official-source.mjs'
import { validateProxyCaBundle } from './prepare-proxy-ca.mjs'
const [source, root, tag] = process.argv.slice(2)
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const ca = join(root, 'config/proxy-root-ca.crt')
const certificates = validateProxyCaBundle(readFileSync(ca, 'utf8'))
const version = JSON.parse(readFileSync(join(source, 'package.json'))).version
const changes = execFileSync('git', ['-C', source, 'diff', '--binary'])
const changedFiles = verifyOfficialSource(source)
let cleanupDiff
try { execFileSync('git', ['-C', source, 'diff', '--no-index', '--', '/dev/null', 'apps/desktop/src/kylin-process-tree.ts']) }
catch (error) { if (error.status !== 1) throw error; cleanupDiff = error.stdout }
writeFileSync(join(root, 'dist/UPSTREAM-PATCH.diff'), Buffer.concat([changes, cleanupDiff]))
const target = join(source, 'apps/desktop/.desktop-build/targets/linux-arm64')
copyFileSync(join(target, 'runtime-patches.diff'), join(root, 'dist/RUNTIME-PATCH.diff'))
writeFileSync(join(root, 'dist/BUILD-INFO.json'), JSON.stringify({
  sourceRepository: 'https://github.com/deepseek-ai/deepseek-harness',
  sourceRef: tag,
  sourceCommit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  repositoryVersion: version,
  debianRevision: process.env.DSH_BUILD_REVISION,
  packagingCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  desktop: 'official-apps-desktop',
  desktopAppearance: 'official-40px-integrated-caption-with-linux-native-window-controls',
  productSource: 'official-entrypoint-with-exact-linux-shell-adapters',
  modifiedOfficialFiles: changedFiles,
  desktopTransportSmoke: '40-compressed-rpc-replies-with-live-event-stream',
  desktopConnectionSmoke: 'materialized-and-final-asar-official-page-and-host-60s-native-sse-mux',
  desktopLauncherSmoke: 'final-deb-integrated-caption-drag-maximize-minimize-60s-mux-sse-taskbar-icon-close-to-tray-restore-menu-quit',
  linuxTray: 'png-icon-status-notifier-click-restore-localized-menu-graceful-quit',
  electronVersion: createRequire(join(source, 'apps/desktop/package.json'))('electron/package.json').version,
  linuxProcessCleanup: 'graceful-host-shutdown-then-owned-descendants-term-kill-with-pid-reuse-check',
  linuxProcessCleanupSha256: hash(join(root, 'build/kylin-process-tree.ts')),
  websocketCompatibility: 'omit-zero-length-payload-iovec-with-identical-frame-bytes',
  websocketCompatibilitySmoke: 'baseline-efault-first-ping-vs-30-fixed-ping-pong-cycles-and-data',
  platform: 'linux-arm64',
  launcherCompatibility: 'x11-when-display-present-gpu-disabled-by-default-explicit-sandbox-override',
  glibcMaximum: '2.28',
  proxyCaSha256: hash(ca),
  proxyCaCertificates: certificates.map(certificate => ({
    subject: certificate.subject,
    issuer: certificate.issuer,
    fingerprintSha256: certificate.fingerprint256,
    validTo: certificate.validTo,
  })),
  upstreamPatchSha256: hash(join(root, 'dist/UPSTREAM-PATCH.diff')),
  runtimePatchSha256: hash(join(root, 'dist/RUNTIME-PATCH.diff')),
  runtimePatches: JSON.parse(readFileSync(join(target, 'runtime-patches.json'))),
}, null, 2) + '\n')
