import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// The tagged Runtime only understands host suffixes in NO_PROXY. The carrier
// supplies RFC1918 CIDRs; teach the shared routing policy to honor those entries.
export function patchProxyPolicy(source) {
  const crlf = source.includes('\r\n')
  let code = source.replace(/\r\n/g, '\n')
  if (code.includes('function matchesIpv4Cidr(')) return source
  const anchor = 'export function bypassesProxy(noProxy: string, url: URL): boolean {'
  const match = "    if (entry === '*') return true"
  if (!code.includes(anchor) || !code.includes(match)) {
    throw new Error('patch-upstream: unsupported http-proxy policy; refusing to build without CIDR bypass')
  }
  const helper = `function matchesIpv4Cidr(host: string, entry: string): boolean {
  const parts = entry.split('/')
  if (parts.length !== 2 || !/^\\d{1,2}$/.test(parts[1] ?? '')) return false
  const prefix = Number(parts[1])
  if (prefix > 32) return false
  const ipv4 = (value: string): number | undefined => {
    const octets = value.split('.')
    if (octets.length !== 4 || octets.some(octet => !/^\\d{1,3}$/.test(octet) || Number(octet) > 255)) return undefined
    return octets.reduce((address, octet) => address * 256 + Number(octet), 0)
  }
  const address = ipv4(host)
  const network = ipv4(parts[0] ?? '')
  if (address === undefined || network === undefined) return false
  const size = 2 ** (32 - prefix)
  return Math.floor(address / size) === Math.floor(network / size)
}

`
  code = code.replace(anchor, helper + anchor).replace(match, match + `
    if (entry.includes('/')) {
      if (matchesIpv4Cidr(host, entry)) return true
      continue
    }`)
  code = code.replace(
    " * CIDR notation is not matched —\n * an operating system's bypass list often carries `10.0.0.0/8`, which must be rewritten as suffixes.",
    ' * IPv4 CIDR entries are matched against literal IPv4 destinations without DNS resolution.',
  )
  return crlf ? code.replace(/\n/g, '\r\n') : code
}

export function patchUpstreamProxy(sourceDir) {
  const target = resolve(sourceDir, 'packages/util/http-proxy/src/policy.ts')
  const source = readFileSync(target, 'utf8')
  const patched = patchProxyPolicy(source)
  if (patched === source) return
  writeFileSync(target, patched)
  rmSync(resolve(sourceDir, 'packages/util/http-proxy/lib'), { recursive: true, force: true })
  console.log('patch-upstream: patched shared HTTP proxy policy for IPv4 CIDR bypass')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: patch-upstream-proxy.mjs <official-source-dir>')
  patchUpstreamProxy(process.argv[2])
}
