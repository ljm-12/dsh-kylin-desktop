import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const upstream = process.env.DSH_SOURCE_DIR
if (!upstream) throw new Error('DSH_SOURCE_DIR must identify the pinned official checkout')
const { createElectronBuilderConfig } = await import(join(upstream, 'apps/desktop/scripts/electron-builder-config.mjs'))
const config = createElectronBuilderConfig(process.env, 'linux', 'arm64')
const packagingCommit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const revision = process.env.DSH_BUILD_REVISION
if (!revision || !/^\d+\.\d+$/.test(revision)) throw new Error('DSH_BUILD_REVISION must be a numeric build and attempt')
export default {
  ...config,
  // 44.0.0 registers an invalid combined bus-name/path with UKUI's watcher.
  electronVersion: '44.5.1',
  appId: 'ai.deepseek.harness.kylin',
  productName: 'DeepSeek Harness Kylin',
  buildNumber: revision,
  extraMetadata: {
    ...config.extraMetadata,
    homepage: 'https://github.com/ljm-12/dsh-kylin-desktop',
    kylinBuild: { packagingCommit, revision },
  },
  executableName: 'deepseek-harness-kylin',
  artifactName: 'DeepSeek-Harness-Kylin-ARM64-${version}.${ext}',
  directories: { ...config.directories, output: join(root, 'dist') },
  publish: null,
  extraResources: [
    ...config.extraResources,
    { from: join(root, 'config/proxy-root-ca.crt'), to: 'config/proxy-root-ca.crt' },
    { from: join(root, 'build/kylin-launcher.sh'), to: 'kylin-launcher.sh' },
  ],
  linux: {
    ...config.linux,
    icon: join(upstream, 'apps/desktop/resources/icon-windows.png'),
    maintainer: 'Kylin Desktop Maintainer <root@localhost>',
    target: [{ target: 'deb', arch: ['arm64'] }],
  },
  deb: {
    packageName: 'deepseek-harness-kylin',
    depends: ['libgtk-3-0', 'libnss3', 'libasound2', 'libxss1', 'libxtst6', 'xdg-utils', 'ca-certificates'],
    afterInstall: join(root, 'build/deb-postinstall.sh'),
    afterRemove: join(root, 'build/deb-postrm.sh'),
    fpm: ['--replaces', 'dsh-intranet-agent', '--conflicts', 'dsh-intranet-agent'],
  },
}
