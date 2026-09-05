import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageRuntime } from '../src/stage-runtime.ts'

const roots: string[] = []

async function workdir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function arm64Elf(marker: number): Buffer {
  const bytes = Buffer.alloc(24, marker)
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
  bytes.writeUInt16LE(183, 18)
  return bytes
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Runtime staging', () => {
  it('copies the official pair and records its exact provenance and hashes', async () => {
    const packageRoot = await workdir('dsh-kylin-stage-target-')
    const source = await workdir('dsh-kylin-stage-source-')
    await writeFile(join(source, 'deepseek-harness-sdk-runtime-linux-arm64'), arm64Elf(1))
    await writeFile(join(source, 'deepseek-harness-sdk-runtime-linux-arm64-rg'), arm64Elf(2))
    const info = await stageRuntime(packageRoot, source, {
      sourceRef: 'dsh-v0.1.2-rc.1',
      sourceCommit: 'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
      repositoryVersion: '0.1.2-rc.1',
    })
    expect(info.sourceRepository).toBe('https://github.com/deepseek-ai/deepseek-harness')
    expect(info.runtimeSha256).not.toBe(info.ripgrepSha256)
    const recorded = JSON.parse(await readFile(join(packageRoot, 'runtime', 'BUILD-INFO.json'), 'utf8'))
    expect(recorded).toEqual(info)
  })
})
