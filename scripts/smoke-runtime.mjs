import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRuntimeEnvironment, RuntimeProcess } from '../lib/runtime-process.js'

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const executable = resolve(process.argv[2] ?? join(packageRoot, 'runtime', 'deepseek-harness-sdk-runtime-linux-arm64'))
const patch = resolve(process.argv[3] ?? join(packageRoot, 'config', 'intranet.cordis.patch.yml'))
const root = await mkdtemp(join(tmpdir(), 'dsh-kylin-runtime-smoke-'))
const home = join(root, 'home')
const workspace = join(root, 'workspace')
await mkdir(home, { mode: 0o700 })
await mkdir(workspace, { mode: 0o700 })

const runtime = new RuntimeProcess({
  command: executable,
  args: ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0'],
  cwd: workspace,
  env: createRuntimeEnvironment(process.env, home),
  readyTimeoutMs: 120_000,
  shutdownTimeoutMs: 10_000,
  onLine: (stream, line) => process[stream === 'stdout' ? 'stdout' : 'stderr'].write(`${line}\n`),
})

try {
  const authenticated = await runtime.start()
  const exchange = await fetch(authenticated, { redirect: 'manual' })
  if (![302, 303].includes(exchange.status)) {
    throw new Error(`smoke-runtime: token exchange returned HTTP ${String(exchange.status)}.`)
  }
  const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
  const location = exchange.headers.get('location')
  if (cookie === undefined || location === null) throw new Error('smoke-runtime: token exchange omitted its cookie or redirect.')
  const clean = new URL(location, authenticated)
  if (clean.origin !== authenticated.origin) throw new Error(`smoke-runtime: token exchange redirected outside ${authenticated.origin}.`)
  const page = await fetch(clean, { headers: { cookie } })
  const html = await page.text()
  if (!page.ok || !/<html(?:\s|>)/iu.test(html)) {
    throw new Error(`smoke-runtime: authenticated root returned HTTP ${String(page.status)} without an HTML document.`)
  }
  console.log(`smoke-runtime: authenticated Web profile served ${clean.origin}`)
} finally {
  try {
    await runtime.stop()
  } finally {
    const resolved = resolve(root)
    if (dirname(resolved) !== resolve(tmpdir()) || !resolved.startsWith(join(resolve(tmpdir()), 'dsh-kylin-runtime-smoke-'))) {
      throw new Error(`smoke-runtime: refusing unsafe cleanup target ${resolved}`)
    }
    await rm(resolved, { recursive: true, force: true })
  }
}
