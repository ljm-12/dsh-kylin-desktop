import { execFileSync, spawn } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'

test('bundled proxy certificate is an unexpired CA with no private key', () => {
  const pem = readFileSync(new URL('../config/proxy-root-ca.crt', import.meta.url))
  assert.doesNotMatch(pem.toString(), /PRIVATE KEY/)
  const cert = new X509Certificate(pem)
  assert.equal(cert.ca, true)
  assert.ok(Date.parse(cert.validFrom) <= Date.now())
  assert.ok(Date.parse(cert.validTo) > Date.now())
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
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  }
})
