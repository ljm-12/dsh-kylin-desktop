/** Track only this desktop's descendants, including workers that detach/reparent. */
import { readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

interface LinuxProcess { pid: number; parent: number; started: string; state: string }

function processes(): Map<number, LinuxProcess> {
  const result = new Map<number, LinuxProcess>()
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      result.set(Number(name), { pid: Number(name), parent: Number(fields[1]), started: fields[19]!, state: fields[0]! })
    } catch (error) {
      if (!['ENOENT', 'ESRCH', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    }
  }
  return result
}

function electronOwnsExit(pid: number): boolean {
  try {
    const executable = readlinkSync(`/proc/${pid}/exe`)
    if (executable === join(dirname(process.execPath), 'chrome_crashpad_handler')) return true
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
      .some(argument => /(?:^|\s)--type=(?:renderer|zygote|gpu-process|utility)(?:\s|$)/.test(argument))
  } catch (error) {
    if (['ENOENT', 'ESRCH', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) return true
    throw error
  }
}

export class KylinProcessTree {
  private readonly owned = new Map<number, LinuxProcess>()
  private readonly timer: ReturnType<typeof setInterval>
  private readonly root: number
  constructor(root = process.pid) {
    this.root = root
    this.capture()
    this.timer = setInterval(() => this.capture(), 200)
    this.timer.unref()
  }

  private capture(): LinuxProcess[] {
    const current = processes()
    const parents = new Set([this.root])
    for (const [pid, known] of this.owned) {
      if (current.get(pid)?.started === known.started) parents.add(pid)
    }
    let changed = true
    while (changed) {
      changed = false
      for (const item of current.values()) {
        if (item.pid !== this.root && parents.has(item.parent) && !parents.has(item.pid)) {
          this.owned.set(item.pid, item)
          parents.add(item.pid)
          changed = true
        }
      }
    }
    return [...this.owned.values()].filter(item => {
      const live = current.get(item.pid)
      // Electron must close its renderer/GPU/zygote itself; killing them while
      // the browser is alive triggers automatic restarts instead of shutdown.
      return live?.started === item.started && live.state !== 'Z' && live.state !== 'X' && !electronOwnsExit(item.pid)
    })
  }

  /** Called after upstream Host/storage shutdown; reap remaining owned workers. */
  async stop(): Promise<void> {
    clearInterval(this.timer)
    const signal = (name: NodeJS.Signals): void => {
      for (const item of this.capture().reverse()) {
        // Re-read the start time immediately before signalling to reject PID reuse.
        try {
          const stat = readFileSync(`/proc/${item.pid}/stat`, 'utf8')
          if (stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== item.started) continue
          process.kill(item.pid, name)
        } catch (error) {
          if (!['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        }
      }
    }
    signal('SIGTERM')
    for (let i = 0; i < 10 && this.capture().length > 0; i++) await delay(100)
    signal('SIGKILL')
    for (let i = 0; i < 20 && this.capture().length > 0; i++) await delay(100)
    if (this.capture().length > 0) throw new Error('Kylin desktop workers did not exit')
  }
}
