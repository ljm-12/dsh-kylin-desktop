import { execFileSync } from 'node:child_process'
import { createHash, X509Certificate } from 'node:crypto'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [source, root, tag] = process.argv.slice(2)
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const ca = join(root, 'config/proxy-root-ca.crt')
const certificate = new X509Certificate(readFileSync(ca))
if (!certificate.ca || Date.parse(certificate.validTo) < Date.now()) throw new Error('Invalid or expired proxy CA')
const version = JSON.parse(readFileSync(join(source, 'package.json'))).version
const changes = execFileSync('git', ['-C', source, 'diff', '--binary'])
writeFileSync(join(root, 'dist/UPSTREAM-PATCH.diff'), changes)
const target = join(source, 'apps/desktop/.desktop-build/targets/linux-arm64')
copyFileSync(join(target, 'runtime-patches.diff'), join(root, 'dist/RUNTIME-PATCH.diff'))
writeFileSync(join(root, 'dist/BUILD-INFO.json'), JSON.stringify({
  sourceRepository: 'https://github.com/deepseek-ai/deepseek-harness',
  sourceRef: tag,
  sourceCommit: execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  repositoryVersion: version,
  packagingCommit: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  desktop: 'official-apps-desktop',
  platform: 'linux-arm64',
  glibcMaximum: '2.28',
  proxyCaSha256: hash(ca),
  upstreamPatchSha256: hash(join(root, 'dist/UPSTREAM-PATCH.diff')),
  runtimePatchSha256: hash(join(root, 'dist/RUNTIME-PATCH.diff')),
  runtimePatches: JSON.parse(readFileSync(join(target, 'runtime-patches.json'))),
}, null, 2) + '\n')
