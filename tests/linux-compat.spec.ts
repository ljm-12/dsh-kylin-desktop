import { describe, expect, it, vi } from 'vitest'
import { configureLinuxPlatformCompatibility, type CommandLineSwitchTarget } from '../src/main.ts'

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
      { name: 'disable-gpu', value: undefined },
      { name: 'disable-dev-shm-usage', value: undefined },
      { name: 'disable-accelerated-video-decode', value: undefined },
      { name: 'disable-gpu-compositing', value: undefined },
      { name: 'disable-gpu-rasterization', value: undefined },
      { name: 'use-gl', value: 'disabled' },
    ])
    expect(env.GDK_BACKEND).toBe('x11')
    expect(disableHardwareAcceleration).toHaveBeenCalledOnce()
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

    expect(switches).toEqual([{ name: 'ozone-platform', value: 'x11' }])
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
})
