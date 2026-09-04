import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Arch, build, Platform, type Configuration } from 'electron-builder'

interface BuildInfo {
  repositoryVersion?: unknown
}

/** electron-builder configuration for the Kylin ARM64 carrier. */
export function packageConfiguration(version: string): Configuration {
  return {
    appId: 'ai.deepseek.harness.kylin',
    productName: 'DeepSeek Harness Kylin',
    executableName: 'deepseek-harness-kylin',
    asar: true,
    compression: 'maximum',
    npmRebuild: false,
    publish: null,
    extraMetadata: { version },
    directories: {
      output: 'dist',
    },
    files: [
      'lib/**/*',
      'package.json',
    ],
    extraResources: [
      { from: 'runtime', to: 'runtime' },
      { from: 'config', to: 'config' },
      { from: 'office', to: 'office' },
      { from: 'skills', to: 'skills' },
    ],
    artifactName: `DeepSeek-Harness-Kylin-ARM64-${version}.\${ext}`,
    linux: {
      icon: 'build/icon.png',
      category: 'Development',
      maintainer: 'Local Intranet Administrator <root@localhost>',
      vendor: 'DeepSeek Harness Kylin Packaging',
      synopsis: 'DeepSeek Harness desktop carrier for Kylin ARM64',
      description: 'Thin Electron carrier for the tagged official DeepSeek Harness ARM64 Runtime.',
      target: [
        { target: 'deb', arch: ['arm64'] },
        { target: 'AppImage', arch: ['arm64'] },
      ],
    },
    deb: {
      packageName: 'deepseek-harness-kylin',
      priority: 'optional',
      depends: ['libgtk-3-0', 'libnss3', 'libasound2', 'libxss1', 'libxtst6', 'xdg-utils'],
      afterInstall: 'build/deb-postinstall.sh',
      afterRemove: 'build/deb-postrm.sh',
      fpm: [
        '--replaces', 'dsh-intranet-agent',
        '--conflicts', 'dsh-intranet-agent',
        '--provides', 'dsh-intranet-agent',
        '--before-install', 'build/deb-preinstall.sh',
      ],
    },
  }
}

async function main(): Promise<void> {
  const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const info = JSON.parse(await readFile(resolve(packageRoot, 'runtime', 'BUILD-INFO.json'), 'utf8')) as BuildInfo
  if (typeof info.repositoryVersion !== 'string' || info.repositoryVersion.length === 0) {
    throw new Error('build-package: staged Runtime has no repositoryVersion.')
  }
  const artifacts = await build({
    projectDir: packageRoot,
    targets: Platform.LINUX.createTarget(['deb', 'AppImage'], Arch.arm64),
    config: packageConfiguration(info.repositoryVersion),
  })
  for (const artifact of artifacts) console.log(`build-package: ${artifact}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
