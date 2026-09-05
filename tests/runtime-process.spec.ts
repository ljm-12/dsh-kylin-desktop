import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createRuntimeEnvironment,
  parseRuntimeReadyUrl,
  redactRuntimeLine,
  RuntimeProcess,
} from '../src/runtime-process.ts'

const fixture = fileURLToPath(new URL('./fixtures/runtime-child.mjs', import.meta.url))
const roots: string[] = []
const processes: RuntimeProcess[] = []

async function workdir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kylin-desktop-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(processes.splice(0).map(async process => { await process.stop() }))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Runtime readiness', () => {
  it('accepts only an authenticated IPv4 loopback URL', () => {
    expect(parseRuntimeReadyUrl('dsh web: http://127.0.0.1:4123/?token=abc')?.port).toBe('4123')
    expect(parseRuntimeReadyUrl('dsh web: http://localhost:4123/?token=abc')).toBeUndefined()
    expect(parseRuntimeReadyUrl('dsh web: http://10.0.0.2:4123/?token=abc')).toBeUndefined()
    expect(parseRuntimeReadyUrl('dsh web: http://127.0.0.1:4123/')).toBeUndefined()
    expect(parseRuntimeReadyUrl('unrelated output')).toBeUndefined()
  })

  it('waits for a complete split readiness line and stops the child to quiescence', async () => {
    const lines: string[] = []
    const runtime = new RuntimeProcess({
      command: processExecPath(),
      args: [fixture, 'ready'],
      cwd: await workdir(),
      env: process.env,
      readyTimeoutMs: 2_000,
      shutdownTimeoutMs: 2_000,
      onLine: (_stream, line) => lines.push(line),
    })
    processes.push(runtime)
    const url = await runtime.start()
    expect(url.href).toBe('http://127.0.0.1:43123/?token=fixture-secret')
    expect(lines).toContain('dsh web: http://127.0.0.1:43123/?token=<redacted>')
    expect(await runtime.stop()).toMatchObject({ signal: 'SIGTERM' })
  })

  it('reports stderr when the child exits before readiness', async () => {
    const runtime = new RuntimeProcess({
      command: processExecPath(),
      args: [fixture, 'early-exit'],
      cwd: await workdir(),
      env: process.env,
      readyTimeoutMs: 2_000,
      shutdownTimeoutMs: 2_000,
    })
    processes.push(runtime)
    await expect(runtime.start()).rejects.toThrow(/code=7[\s\S]*fixture startup failure/u)
  })

  it('reports an exit that follows readiness without treating shutdown as unexpected', async () => {
    let resolveExit: ((value: { code: number | null }) => void) | undefined
    const exit = new Promise<{ code: number | null }>(resolve => { resolveExit = resolve })
    const runtime = new RuntimeProcess({
      command: processExecPath(),
      args: [fixture, 'ready-exit'],
      cwd: await workdir(),
      env: process.env,
      readyTimeoutMs: 2_000,
      shutdownTimeoutMs: 2_000,
      onUnexpectedExit: result => resolveExit?.(result),
    })
    processes.push(runtime)
    await runtime.start()
    await expect(exit).resolves.toEqual({ code: 9, signal: null })
  })

  it.skipIf(process.platform === 'win32')('escalates a child that does not honor graceful shutdown', async () => {
    const runtime = new RuntimeProcess({
      command: processExecPath(),
      args: [fixture, 'ignore-term'],
      cwd: await workdir(),
      env: process.env,
      readyTimeoutMs: 2_000,
      shutdownTimeoutMs: 50,
    })
    processes.push(runtime)
    await runtime.start()
    await expect(runtime.stop()).resolves.toMatchObject({ signal: 'SIGKILL' })
  })
})

describe('Runtime environment', () => {
  it('drops credential variables and fixes local no-proxy entries', () => {
    const env = createRuntimeEnvironment({
      PATH: '/usr/bin',
      DEEPSEEK_API_KEY: 'secret',
      PRIVATE_TOKEN: 'secret',
      XAUTHORITY: '/run/user/auth',
      no_proxy: 'model.intra',
    }, '/config/dsh')
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      XAUTHORITY: '/run/user/auth',
      DSH_HOME: '/config/dsh',
      DSH_TELEMETRY_DISABLED: '1',
      NO_PROXY: '127.0.0.1,localhost,model.intra',
    })
    expect(env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(env.PRIVATE_TOKEN).toBeUndefined()
    expect(env.no_proxy).toBeUndefined()
  })

  it('redacts readiness tokens before logging', () => {
    expect(redactRuntimeLine('dsh web: http://127.0.0.1:3/?token=abc&x=1'))
      .toBe('dsh web: http://127.0.0.1:3/?token=<redacted>&x=1')
  })
})

function processExecPath(): string {
  return process.execPath
}
