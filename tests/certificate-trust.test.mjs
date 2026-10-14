import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareProxyCa, validateProxyCaBundle } from '../scripts/prepare-proxy-ca.mjs'

test('every bundled proxy certificate is a valid public CA', () => {
  const pem = readFileSync(new URL('../config/proxy-root-ca.crt', import.meta.url), 'utf8')
  assert.ok(validateProxyCaBundle(pem).length > 0)
})

test('Node/Electron Node mode validates a proxy-signed TLS server only with its CA', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-proxy-ca-test-'))
  const ca = join(root, 'ca.pem')
  let server
  try {
    writeFileSync(join(root, 'ca.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Test Proxy Root\n[ca]\nbasicConstraints=critical,CA:true\nkeyUsage=critical,keyCertSign,cRLSign\n')
    writeFileSync(join(root, 'server.cnf'), 'subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:false\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    const openssl = args => execFileSync('openssl', args, { cwd: root, stdio: 'pipe' })
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', ca,
      '-days', '1', '-config', 'ca.cnf'])
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=127.0.0.1'])
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', ca, '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', 'server.pem', '-days', '1', '-extfile', 'server.cnf'])
    server = createServer({ key: readFileSync(join(root, 'server.key')), cert: readFileSync(join(root, 'server.pem')) },
      (_req, res) => res.end('verified'))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const script = `require('node:https').get('https://127.0.0.1:${server.address().port}',r=>{r.resume();r.on('end',()=>console.log('trusted'))}).on('error',e=>{console.error(e.code);process.exitCode=1})`
    async function request(extraCa) {
      const env = { ...process.env }
      delete env.NODE_EXTRA_CA_CERTS
      delete env.NODE_TLS_REJECT_UNAUTHORIZED
      delete env.NODE_OPTIONS
      if (extraCa) env.NODE_EXTRA_CA_CERTS = extraCa
      const child = spawn(process.env.DSH_TEST_NODE ?? process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout.on('data', bytes => { output += bytes })
      child.stderr.on('data', bytes => { output += bytes })
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000)
      const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) })
      clearTimeout(timer)
      return { code, output }
    }
    const untrusted = await request()
    assert.equal(untrusted.code, 1, untrusted.output)
    assert.match(untrusted.output, /CERT|ISSUER|VERIFY/)
    const trusted = await request(ca)
    assert.equal(trusted.code, 0, trusted.output)
    assert.match(trusted.output, /trusted/)

    // Reproduce the intranet chain: intermediate and root share a subject,
    // and the server sends the root before the intermediate. Root-only trust
    // fails; loading both public CAs must work with certificate checks enabled.
    writeFileSync(join(root, 'intermediate.cnf'), 'basicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=none\n')
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'intermediate.key',
      '-out', 'intermediate.csr', '-subj', '/CN=Test Proxy Root'])
    openssl(['x509', '-req', '-in', 'intermediate.csr', '-CA', ca, '-CAkey', 'ca.key',
      '-CAcreateserial', '-out', 'intermediate.pem', '-days', '1', '-extfile', 'intermediate.cnf'])
    openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'intermediate.pem', '-CAkey', 'intermediate.key',
      '-CAcreateserial', '-out', 'intermediate-server.pem', '-days', '1', '-extfile', 'server.cnf'])
    const caPem = readFileSync(ca, 'utf8')
    const intermediatePem = readFileSync(join(root, 'intermediate.pem'), 'utf8')
    const leafPem = readFileSync(join(root, 'intermediate-server.pem'), 'utf8')
    server.setSecureContext({ key: readFileSync(join(root, 'server.key')), cert: leafPem + caPem + intermediatePem })
    const rootOnly = await request(ca)
    assert.equal(rootOnly.code, 1, rootOnly.output)
    assert.match(rootOnly.output, /CERT|ISSUER|VERIFY/)
    const bundle = prepareProxyCa(root, { DSH_PROXY_CA_CERT_PEM: caPem + intermediatePem })
    assert.equal(validateProxyCaBundle(readFileSync(bundle, 'utf8')).length, 2)
    const bundledTrust = await request(bundle)
    assert.equal(bundledTrust.code, 0, bundledTrust.output)
    assert.match(bundledTrust.output, /trusted/)
    assert.throws(() => prepareProxyCa(root, { DSH_PROXY_CA_CERT_PEM: caPem + leafPem }), /valid CA/)
    assert.equal(readFileSync(bundle, 'utf8'), caPem + intermediatePem)
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
