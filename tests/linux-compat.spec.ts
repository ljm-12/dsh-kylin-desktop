import { describe, expect, it } from 'vitest'
import { configureLinuxPlatformCompatibility, type CommandLineSwitchTarget } from '../src/main.ts'

describe('configureLinuxPlatformCompatibility', () => {
  it('applies X11 ozone platform and GDK_BACKEND on linux when not explicitly specified', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = {}

    configureLinuxPlatformCompatibility('linux', env, commandLine)

    expect(switches).toEqual([{ name: 'ozone-platform', value: 'x11' }])
    expect(env.GDK_BACKEND).toBe('x11')
  })

  it('respects user-specified ozone platform without overriding', () => {
    const switches: Array<{ name: string; value?: string }> = [{ name: 'ozone-platform', value: 'wayland' }]
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = { GDK_BACKEND: 'wayland' }

    configureLinuxPlatformCompatibility('linux', env, commandLine)

    expect(switches).toEqual([{ name: 'ozone-platform', value: 'wayland' }])
    expect(env.GDK_BACKEND).toBe('wayland')
  })

  it('does nothing on non-linux platforms', () => {
    const switches: Array<{ name: string; value?: string }> = []
    const commandLine: CommandLineSwitchTarget = {
      appendSwitch: (name, value) => { switches.push({ name, value }) },
      hasSwitch: name => switches.some(s => s.name === name),
    }
    const env: NodeJS.ProcessEnv = {}

    configureLinuxPlatformCompatibility('win32', env, commandLine)
    configureLinuxPlatformCompatibility('darwin', env, commandLine)

    expect(switches).toHaveLength(0)
    expect(env.GDK_BACKEND).toBeUndefined()
  })
})
