import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'

const READY_PREFIX = 'dsh web: '
const MAX_DIAGNOSTIC_CHARS = 16_384
const SENSITIVE_ENV_NAME = /(?:^|_)(?:API_?KEY|SECRET|TOKEN|PASSWORD|CREDENTIALS?)(?:_|$)/iu

/** Runtime process termination facts. */
export interface RuntimeExit {
  code: number | null
  signal: NodeJS.Signals | null
}

/** Inputs owned by one desktop Runtime process. */
export interface RuntimeProcessOptions {
  command: string
  args: readonly string[]
  cwd: string
  env: NodeJS.ProcessEnv
  readyTimeoutMs: number
  shutdownTimeoutMs: number
  onLine?: (stream: 'stdout' | 'stderr', line: string) => void
  onUnexpectedExit?: (result: RuntimeExit) => void
}

/** Error raised when the Runtime cannot reach its authenticated Web URL. */
export class RuntimeStartupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RuntimeStartupError'
  }
}

/** Convert one complete `dsh web:` readiness line into a loopback URL. */
export function parseRuntimeReadyUrl(line: string): URL | undefined {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const candidate = line.slice(READY_PREFIX.length).split(' ', 1)[0]
  if (candidate === undefined || candidate.length === 0) return undefined
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.port === '') return undefined
  if (url.username !== '' || url.password !== '' || url.searchParams.get('token') === null) return undefined
  return url
}

/** Remove credential-bearing values before the desktop shell launches dsh. */
export function createRuntimeEnvironment(parent: NodeJS.ProcessEnv, dshHome: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || SENSITIVE_ENV_NAME.test(name)) continue
    env[name] = value
  }
  env.DSH_HOME = dshHome
  env.DSH_TELEMETRY_DISABLED = '1'
  const existingNoProxy = env.NO_PROXY ?? env.no_proxy ?? ''
  env.NO_PROXY = [...new Set(['127.0.0.1', 'localhost', ...existingNoProxy.split(',').map(value => value.trim()).filter(Boolean)])].join(',')
  delete env.no_proxy
  return env
}

/** Remove the one-time browser credential from persisted diagnostics. */
export function redactRuntimeLine(line: string): string {
  return line.replace(/([?&]token=)[^&\s)]+/giu, '$1<redacted>')
}

class LineBuffer {
  private pending = ''

  push(chunk: Buffer | string): string[] {
    this.pending += chunk.toString()
    const lines = this.pending.split(/\r?\n/u)
    this.pending = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    if (this.pending.length === 0) return []
    const line = this.pending
    this.pending = ''
    return [line]
  }
}

type RuntimeChild = ChildProcessByStdio<null, Readable, Readable>

/** Own one dsh Web Runtime from spawn through quiescent shutdown. */
export class RuntimeProcess {
  private child: RuntimeChild | undefined
  private exitPromise: Promise<RuntimeExit> | undefined
  private stopping = false
  private ready = false
  private stderrTail = ''

  constructor(private readonly options: RuntimeProcessOptions) {}

  /** Spawn dsh and resolve only after its authenticated loopback URL is announced. */
  async start(): Promise<URL> {
    if (this.child !== undefined) throw new RuntimeStartupError('Runtime process has already been started.')
    const child = spawn(this.options.command, [...this.options.args], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.exitPromise = new Promise(resolve => {
      child.once('close', (code, signal) => {
        const result = { code, signal }
        resolve(result)
        if (this.ready && !this.stopping) this.options.onUnexpectedExit?.(result)
      })
    })

    const stdout = new LineBuffer()
    const stderr = new LineBuffer()
    child.stderr.on('data', (chunk: Buffer | string) => {
      for (const line of stderr.push(chunk)) this.recordLine('stderr', line)
    })

    return await new Promise<URL>((resolve, reject) => {
      let settled = false
      const finish = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        child.off('error', failed)
        child.off('close', closed)
        action()
      }
      const failed = (error: Error): void => {
        finish(() => reject(new RuntimeStartupError(this.withDiagnostics(`Runtime spawn failed: ${error.message}`))))
      }
      const closed = (code: number | null, signal: NodeJS.Signals | null): void => {
        for (const line of stdout.flush()) this.recordLine('stdout', line)
        for (const line of stderr.flush()) this.recordLine('stderr', line)
        finish(() => reject(new RuntimeStartupError(this.withDiagnostics(
          `Runtime exited before readiness (code=${String(code)}, signal=${String(signal)}).`,
        ))))
      }
      const timeout = setTimeout(() => {
        finish(() => reject(new RuntimeStartupError(this.withDiagnostics(
          `Runtime did not announce readiness within ${String(this.options.readyTimeoutMs)} ms.`,
        ))))
      }, this.options.readyTimeoutMs)
      child.on('error', failed)
      child.on('close', closed)
      child.stdout.on('data', (chunk: Buffer | string) => {
        for (const line of stdout.push(chunk)) {
          this.recordLine('stdout', line)
          const url = parseRuntimeReadyUrl(line)
          if (url !== undefined) finish(() => {
            this.ready = true
            resolve(url)
          })
        }
      })
    })
  }

  /** Request graceful termination, escalate once, and wait for process exit. */
  async stop(): Promise<RuntimeExit | undefined> {
    const child = this.child
    const exit = this.exitPromise
    if (child === undefined || exit === undefined) return undefined
    this.stopping = true
    if (child.exitCode !== null || child.signalCode !== null) return await exit
    child.kill('SIGTERM')
    const graceful = await this.waitForExit(exit, this.options.shutdownTimeoutMs)
    if (graceful !== undefined) return graceful
    child.kill('SIGKILL')
    return await exit
  }

  private async waitForExit(exit: Promise<RuntimeExit>, timeoutMs: number): Promise<RuntimeExit | undefined> {
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), timeoutMs)
    })
    const result = await Promise.race([exit, timeout])
    if (timer !== undefined) clearTimeout(timer)
    return result
  }

  private recordLine(stream: 'stdout' | 'stderr', line: string): void {
    if (stream === 'stderr') {
      this.stderrTail = `${this.stderrTail}${this.stderrTail.length === 0 ? '' : '\n'}${redactRuntimeLine(line)}`
      if (this.stderrTail.length > MAX_DIAGNOSTIC_CHARS) {
        this.stderrTail = this.stderrTail.slice(-MAX_DIAGNOSTIC_CHARS)
      }
    }
    this.options.onLine?.(stream, redactRuntimeLine(line))
  }

  private withDiagnostics(message: string): string {
    return this.stderrTail.length === 0 ? message : `${message}\n${this.stderrTail}`
  }
}
