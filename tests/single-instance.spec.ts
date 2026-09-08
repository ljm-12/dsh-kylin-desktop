import { mkdirSync, symlinkSync, writeFileSync, rmSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reclaimStaleSingletonLock } from '../src/single-instance.ts'

describe('reclaimStaleSingletonLock', () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `dsh-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (lstatSync(testDir, { throwIfNoEntry: false }) !== undefined) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('returns false if SingletonLock does not exist', () => {
    const result = reclaimStaleSingletonLock(testDir)
    expect(result).toBe(false)
  })

  it('reclaims stale lock when process is dead', () => {
    const lockPath = join(testDir, 'SingletonLock')
    const socketPath = join(testDir, 'SingletonSocket')
    const cookiePath = join(testDir, 'SingletonCookie')

    symlinkSync('myhost-999999', lockPath)
    writeFileSync(socketPath, 'socket')
    writeFileSync(cookiePath, 'cookie')

    const checkProcessAlive = vi.fn().mockReturnValue(false)
    const result = reclaimStaleSingletonLock(testDir, checkProcessAlive)

    expect(result).toBe(true)
    expect(checkProcessAlive).toHaveBeenCalledWith(999999)
    expect(lstatSync(lockPath, { throwIfNoEntry: false })).toBeUndefined()
    expect(lstatSync(socketPath, { throwIfNoEntry: false })).toBeUndefined()
    expect(lstatSync(cookiePath, { throwIfNoEntry: false })).toBeUndefined()
  })

  it('keeps lock intact when process is still alive', () => {
    const lockPath = join(testDir, 'SingletonLock')
    symlinkSync('myhost-12345', lockPath)

    const checkProcessAlive = vi.fn().mockReturnValue(true)
    const result = reclaimStaleSingletonLock(testDir, checkProcessAlive)

    expect(result).toBe(false)
    expect(checkProcessAlive).toHaveBeenCalledWith(12345)
    expect(lstatSync(lockPath, { throwIfNoEntry: false })?.isSymbolicLink()).toBe(true)
  })
})
