import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareProxyCa } from '../scripts/prepare-proxy-ca.mjs'

test('separate proxy CA accepts PEM/file input and rejects missing trust material', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ca-input-test-'))
  try {
    const pem = readFileSync(new URL('../config/proxy-root-ca.crt', import.meta.url), 'utf8')
    assert.throws(() => prepareProxyCa(root, {}), /Proxy CA required/)
    const input = join(root, 'input.crt')
    writeFileSync(input, pem)
    const target = prepareProxyCa(root, { DSH_PROXY_CA_CERT_FILE: input })
    assert.equal(readFileSync(target, 'utf8'), pem)
    assert.equal(prepareProxyCa(root, { DSH_PROXY_CA_CERT_PEM: pem }), target)
    assert.equal(prepareProxyCa(root, {}), target)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('invalid or private material fails before overwriting the prepared CA', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ca-rejection-test-'))
  try {
    const pem = readFileSync(new URL('../config/proxy-root-ca.crt', import.meta.url), 'utf8')
    const target = prepareProxyCa(root, { DSH_PROXY_CA_CERT_PEM: pem })
    for (const value of ['-----BEGIN PRIVATE KEY-----', 'invalid', pem + pem,
      '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----']) {
      assert.throws(() => prepareProxyCa(root, { DSH_PROXY_CA_CERT_PEM: value }))
      assert.equal(readFileSync(target, 'utf8'), pem)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
