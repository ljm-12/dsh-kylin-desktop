import { X509Certificate } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))

export function validateProxyCaBundle(pem) {
  if (/PRIVATE KEY/.test(pem)) throw new Error('Proxy CA must not contain a private key.')
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? []
  if (!blocks.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim()) {
    throw new Error('Provide a public CA certificate or a PEM bundle of public CA certificates.')
  }
  const certificates = blocks.map(block => new X509Certificate(block))
  const seen = new Set()
  for (const certificate of certificates) {
    if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
      throw new Error('Every proxy CA must be a currently valid CA certificate.')
    }
    if (seen.has(certificate.fingerprint256)) throw new Error('Proxy CA bundle contains a duplicate certificate.')
    seen.add(certificate.fingerprint256)
  }
  return certificates
}

export function prepareProxyCa(root = repositoryRoot, env = process.env) {
  const target = resolve(root, 'config/proxy-root-ca.crt')
  let pem
  if (env.DSH_PROXY_CA_CERT_PEM) pem = env.DSH_PROXY_CA_CERT_PEM
  else if (env.DSH_PROXY_CA_CERT_FILE) pem = readFileSync(resolve(root, env.DSH_PROXY_CA_CERT_FILE), 'utf8')
  else {
    try { pem = readFileSync(target, 'utf8') }
    catch { throw new Error('Proxy CA required: set DSH_PROXY_CA_CERT_FILE locally or the DMZ_PROXY_CA_CERT Actions secret.') }
  }
  validateProxyCaBundle(pem)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, pem, { mode: 0o600 })
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareProxyCa()
  console.log('Validated and prepared the separately supplied public proxy CA.')
}
