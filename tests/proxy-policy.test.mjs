import { stripTypeScriptTypes } from 'node:module'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import test from 'node:test'
import { patchProxyPolicy } from '../scripts/patch-upstream-proxy.mjs'

test('official proxy policy plus CIDR support keeps LAN direct and public hosts proxied',
  { skip: !process.env.DSH_TEST_SOURCE }, async () => {
    const source = execFileSync('git', ['-C', process.env.DSH_TEST_SOURCE, 'show',
      'HEAD:packages/util/http-proxy/src/policy.ts'], { encoding: 'utf8' })
    const patched = patchProxyPolicy(source)
    assert.equal(patchProxyPolicy(patched), patched)
    const code = stripTypeScriptTypes(patched)
    const { bypassesProxy } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
    const actual = ['https://10.10.11.1', 'https://172.31.255.254', 'https://192.168.0.40',
      'https://172.32.0.1', 'https://api.deepseek.com'].map(url =>
      bypassesProxy('10.0.0.0/8,172.16.0.0/12,192.168.0.0/16', new URL(url)))
    assert.deepEqual(actual, [true, true, true, false, false])
  })
