import { describe, expect, it, vi } from 'vitest'
import {
  checkLinuxImeRestart,
  configureLinuxPlatformCompatibility,
  type CommandLineSwitchTarget,
} from '../src/main.ts'

describe('configureLinuxPlatformCompatibility', () => {
  it('applies X11 platform, disables hardware acceleration, and adds stability switches on linux', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = {}
    const disableHardwareAcceleration = vi.fn()

    configureLinuxPlatformCompatibility('linux', env, commandLine, { disableHardwareAcceleration })

    expect(switches).toEqual([
      { name: 'ozone-platform', value: 'x11' },
      { name: 'no-sandbox', value: undefined },
      { name: 'disable-features', value: 'UseXdgDesktopPortal' },
      { name: 'disable-gpu', value: undefined },
      { name: 'disable-dev-shm-usage', value: undefined },
      { name: 'disable-accelerated-video-decode', value: undefined },
    ])
    expect(env.GDK_BACKEND).toBe('x11')
    expect(env.GTK_USE_PORTAL).toBe('0')
    expect(env.GTK_IM_MODULE).toBe('fcitx')
    expect(env.QT_IM_MODULE).toBe('fcitx')
    expect(env.XMODIFIERS).toBe('@im=fcitx')
    expect(env.SDL_IM_MODULE).toBe('fcitx')
    expect(disableHardwareAcceleration).toHaveBeenCalledOnce()
  })

  it('respects ibus when XMODIFIERS specifies ibus', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = { XMODIFIERS: '@im=ibus' }
    configureLinuxPlatformCompatibility('linux', env, commandLine)
    expect(env.GTK_IM_MODULE).toBe('ibus')
    expect(env.QT_IM_MODULE).toBe('ibus')
    expect(env.XMODIFIERS).toBe('@im=ibus')
  })

  it('allows opting in to GPU when DSH_ENABLE_GPU is 1', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = { DSH_ENABLE_GPU: '1' }
    const disableHardwareAcceleration = vi.fn()

    configureLinuxPlatformCompatibility('linux', env, commandLine, { disableHardwareAcceleration })

    expect(switches).toEqual([
      { name: 'ozone-platform', value: 'x11' },
      { name: 'no-sandbox', value: undefined },
      { name: 'disable-features', value: 'UseXdgDesktopPortal' },
    ])
    expect(disableHardwareAcceleration).not.toHaveBeenCalled()
  })

  it('respects user-specified ozone platform without overriding', () => {
    const switches: Array<{ name: string; value?: string }> = [{ name: 'ozone-platform', value: 'wayland' }]
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = { GDK_BACKEND: 'wayland' }

    configureLinuxPlatformCompatibility('linux', env, commandLine)

    expect(switches.some(s => s.name === 'ozone-platform' && s.value === 'wayland')).toBe(true)
    expect(env.GDK_BACKEND).toBe('wayland')
  })

  it('does nothing on non-linux platforms', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = {}
    const disableHardwareAcceleration = vi.fn()

    configureLinuxPlatformCompatibility('win32', env, commandLine, { disableHardwareAcceleration })
    configureLinuxPlatformCompatibility('darwin', env, commandLine, { disableHardwareAcceleration })

    expect(switches).toHaveLength(0)
    expect(env.GDK_BACKEND).toBeUndefined()
    expect(disableHardwareAcceleration).not.toHaveBeenCalled()
  })

  it('configures Wayland IME flags when running under pure Wayland session', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = { WAYLAND_DISPLAY: 'wayland-0' }
    const disableHardwareAcceleration = vi.fn()

    configureLinuxPlatformCompatibility('linux', env, commandLine, { disableHardwareAcceleration })

    expect(switches).toContainEqual({ name: 'ozone-platform-hint', value: 'auto' })
    expect(switches).toContainEqual({ name: 'enable-wayland-ime', value: undefined })
    expect(env.GDK_BACKEND).toBeUndefined()
    expect(env.GTK_IM_MODULE).toBeUndefined()
  })
})

describe('checkLinuxImeRestart', () => {
  it('respawns with fcitx environment on Linux X11 when GTK_IM_MODULE is unset', () => {
    const mockSpawner = vi.fn().mockReturnValue({ on: vi.fn() })
    const env: NodeJS.ProcessEnv = { DISPLAY: ':0' }

    const restarted = checkLinuxImeRestart('linux', env, '/usr/bin/deepseek-harness-kylin', ['node', 'main.js'], mockSpawner as any)

    expect(restarted).toBe(true)
    expect(mockSpawner).toHaveBeenCalledOnce()
    const callArgs = mockSpawner.mock.calls[0]
    expect(callArgs[0]).toBe('/usr/bin/deepseek-harness-kylin')
    expect(callArgs[1]).toEqual(['main.js'])
    expect(callArgs[2].env.GTK_IM_MODULE).toBe('fcitx')
    expect(callArgs[2].env.QT_IM_MODULE).toBe('fcitx')
    expect(callArgs[2].env.XMODIFIERS).toBe('@im=fcitx')
    expect(callArgs[2].env.DSH_IM_RESTARTED).toBe('1')
  })

  it('does not respawn when DSH_IM_RESTARTED is already 1', () => {
    const mockSpawner = vi.fn()
    const env: NodeJS.ProcessEnv = { DISPLAY: ':0', DSH_IM_RESTARTED: '1' }

    const restarted = checkLinuxImeRestart('linux', env, '/usr/bin/app', [], mockSpawner as any)

    expect(restarted).toBe(false)
    expect(mockSpawner).not.toHaveBeenCalled()
  })

  it('does not respawn when GTK_IM_MODULE is already set', () => {
    const mockSpawner = vi.fn()
    const env: NodeJS.ProcessEnv = { DISPLAY: ':0', GTK_IM_MODULE: 'fcitx5' }

    const restarted = checkLinuxImeRestart('linux', env, '/usr/bin/app', [], mockSpawner as any)

    expect(restarted).toBe(false)
    expect(mockSpawner).not.toHaveBeenCalled()
  })

  it('does not respawn on non-linux platforms', () => {
    const mockSpawner = vi.fn()
    const env: NodeJS.ProcessEnv = {}

    expect(checkLinuxImeRestart('win32', env, 'app.exe', [], mockSpawner as any)).toBe(false)
    expect(checkLinuxImeRestart('darwin', env, 'app', [], mockSpawner as any)).toBe(false)
    expect(mockSpawner).not.toHaveBeenCalled()
  })
})

