import { lstatSync, readlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Check if a SingletonLock file in userData belongs to a dead process.
 * If the process is dead (ESRCH), unlink the stale lock and socket files so
 * that subsequent `requestSingleInstanceLock()` attempts succeed.
 */
export function reclaimStaleSingletonLock(
  userDataDir: string,
  checkProcessAlive: (pid: number) => boolean = (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException)?.code !== 'ESRCH'
    }
  },
): boolean {
  const lockPath = join(userDataDir, 'SingletonLock')
  try {
    const stat = lstatSync(lockPath, { throwIfNoEntry: false })
    if (stat === undefined || !stat.isSymbolicLink()) return false
    const target = readlinkSync(lockPath)
    const match = target.match(/-(\d+)$/u)
    const pidStr = match?.[1]
    if (pidStr === undefined) return false
    const pid = Number.parseInt(pidStr, 10)
    if (Number.isNaN(pid) || checkProcessAlive(pid)) return false

    unlinkSync(lockPath)
    for (const file of ['SingletonSocket', 'SingletonCookie']) {
      const p = join(userDataDir, file)
      const auxStat = lstatSync(p, { throwIfNoEntry: false })
      if (auxStat !== undefined) {
        try {
          unlinkSync(p)
        } catch {
          // ignore cleanup errors for auxiliary files
        }
      }
    }
    return true
  } catch {
    return false
  }
}
