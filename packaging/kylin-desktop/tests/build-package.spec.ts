import { describe, expect, it } from 'vitest'
import { packageConfiguration } from '../src/build-package.ts'

describe('Kylin package configuration', () => {
  it('derives the artifact version and keeps publication disabled', () => {
    const config = packageConfiguration('0.1.2-rc.1')
    expect(config.extraMetadata).toEqual({ version: '0.1.2-rc.1' })
    expect(config.publish).toBeNull()
    expect(config.npmRebuild).toBe(false)
    expect(config.linux?.icon).toBe('build/icon.png')
    expect(config.extraResources).toEqual([
      { from: 'runtime', to: 'runtime' },
      { from: 'config', to: 'config' },
      { from: 'staging/office', to: 'office' },
      { from: 'skills', to: 'skills' },
    ])
    expect(config.linux?.target).toEqual([
      { target: 'deb', arch: ['arm64'] },
      { target: 'AppImage', arch: ['arm64'] },
    ])
    expect(config.deb?.fpm).toContain('--replaces')
    expect(config.deb?.fpm).toContain('dsh-intranet-agent')
    expect(config.deb?.afterInstall).toBe('build/deb-postinstall.sh')
    expect(config.deb?.afterRemove).toBe('build/deb-postrm.sh')
  })
})
