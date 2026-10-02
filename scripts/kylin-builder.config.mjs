import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const upstream = process.env.DSH_SOURCE_DIR
if (!upstream) throw new Error('DSH_SOURCE_DIR must identify the pinned official checkout')
const { createElectronBuilderConfig } = await import(join(upstream, 'apps/desktop/scripts/electron-builder-config.mjs'))
const config = createElectronBuilderConfig(process.env, 'linux', 'arm64')
export default {
  ...config,
  appId: 'ai.deepseek.harness.kylin',
  productName: 'DeepSeek Harness Kylin',
  extraMetadata: {
    ...config.extraMetadata,
    homepage: 'https://github.com/ljm-12/dsh-kylin-desktop',
  },
  executableName: 'deepseek-harness-kylin',
  artifactName: 'DeepSeek-Harness-Kylin-ARM64-${version}.${ext}',
  directories: { ...config.directories, output: join(root, 'dist') },
  publish: null,
  extraResources: [
    ...config.extraResources,
    { from: join(root, 'config/proxy-root-ca.crt'), to: 'config/proxy-root-ca.crt' },
    { from: join(root, 'config/intranet.cordis.patch.yml'), to: 'config/intranet.cordis.patch.yml' },
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
