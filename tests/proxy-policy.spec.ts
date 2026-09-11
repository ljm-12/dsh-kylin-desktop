import { readFileSync } from 'node:fs'
import { transpileModule, ModuleKind } from 'typescript'
import { describe, expect, it } from 'vitest'
import { patchProxyPolicy } from '../scripts/patch-upstream-proxy.mjs'
import { createRuntimeEnvironment } from '../src/runtime-process.ts'

const source = readFileSync(new URL('./fixtures/upstream-proxy-policy.ts', import.meta.url), 'utf8')
function loadPolicy(code: string): (noProxy: string, url: URL) => boolean {
  const output = transpileModule(code, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText
  const exports: { bypassesProxy?: (noProxy: string, url: URL) => boolean } = {}
  new Function('exports', output)(exports)
  return exports.bypassesProxy!
}
const bypass = loadPolicy(patchProxyPolicy(source))

describe('Runtime proxy CIDR compatibility', () => {
  it('reproduces the tagged Runtime bug and bypasses the configured model server after patching', () => {
    const env = createRuntimeEnvironment({ HTTP_PROXY: 'http://proxy.invalid:8080' }, '/config/dsh')
    const url = new URL('http://192.168.0.40:3000/v1/models')
    expect(loadPolicy(source)(env.NO_PROXY!, url)).toBe(false)
    expect(bypass(env.NO_PROXY!, url)).toBe(true)
    expect(bypass(env.NO_PROXY!, new URL('http://192.168.0.40:3000/v1/chat/completions'))).toBe(true)
    expect(bypass(env.NO_PROXY!, new URL('https://example.com'))).toBe(false)
  })

  it.each([
    ['192.168.0.0/16', '192.168.255.255', true],
    ['192.168.0.0/16', '192.169.0.1', false],
    ['10.0.0.0/8', '10.255.255.255', true],
    ['10.0.0.0/8', '11.0.0.1', false],
    ['172.16.0.0/12', '172.16.0.1', true],
    ['172.16.0.0/12', '172.31.255.255', true],
    ['172.16.0.0/12', '172.15.255.255', false],
    ['172.16.0.0/12', '172.32.0.1', false],
    ['192.168.0.40/32', '192.168.0.41', false],
    ['192.168.0.40/32', '192.168.0.40', true],
    ['0.0.0.0/0', '8.8.8.8', true],
    ['0.0.0.0/0', 'example.com', false],
    ['192.168.0.0/33', '192.168.0.40', false],
    ['192.168.0.0/', '192.168.0.40', false],
    ['192.168.999.0/16', '192.168.0.40', false],
  ])('matches %s against %s: %s', (entry, host, expected) => {
    expect(bypass(entry, new URL(`http://${host}:3000`))).toBe(expected)
  })

  it('preserves hostname, port and IPv6 bypass behavior', () => {
    expect(bypass('*.local', new URL('http://model.local:3000'))).toBe(true)
    expect(bypass('model.local:3000', new URL('http://model.local:3001'))).toBe(false)
    expect(bypass('[::1]', new URL('http://[::1]:3000'))).toBe(true)
    expect(bypass('*', new URL('https://example.com'))).toBe(true)
  })

  it('merges both environment casings and keeps the same bypass list for Runtime and children', () => {
    const env = createRuntimeEnvironment({ NO_PROXY: 'upper.intra', no_proxy: 'lower.intra' }, '/config/dsh')
    expect(env.NO_PROXY).toContain('upper.intra')
    expect(env.NO_PROXY).toContain('lower.intra')
    expect(env.no_proxy).toBe(env.NO_PROXY)
  })

  it('is idempotent, supports CRLF, and refuses an unknown upstream implementation', () => {
    const once = patchProxyPolicy(source)
    expect(patchProxyPolicy(once)).toBe(once)
    expect(patchProxyPolicy(source.replace(/\r?\n/g, '\r\n'))).toContain('\r\n')
    expect(() => patchProxyPolicy('unrecognized source')).toThrow('refusing to build')
  })
})
