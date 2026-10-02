import { X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export function prepareProxyCa(root = repositoryRoot, env = process.env) {
  const target = resolve(root, 'config/proxy-root-ca.crt')
  let pem
  if (env.DSH_PROXY_CA_CERT_PEM) pem = env.DSH_PROXY_CA_CERT_PEM
  else if (env.DSH_PROXY_CA_CERT_FILE) pem = readFileSync(resolve(root, env.DSH_PROXY_CA_CERT_FILE), 'utf8')
  else {
    try { pem = readFileSync(target, 'utf8') }
    catch { throw new Error('Proxy CA required: set DSH_PROXY_CA_CERT_FILE locally or the DMZ_PROXY_CA_CERT Actions secret.') }
  }
  if (/PRIVATE KEY/.test(pem)) throw new Error('Proxy CA must not contain a private key.')
  if ((pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1) {
    throw new Error('Provide one public root CA certificate.')
  }
  const certificate = new X509Certificate(pem)
  if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
    throw new Error('Proxy CA must be a currently valid CA certificate.')
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, pem, { mode: 0o600 })
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareProxyCa()
  console.log('Validated and prepared the separately supplied public proxy CA.')
}
