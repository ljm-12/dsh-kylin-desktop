import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRuntimeFiles, verifyArm64Elf, verifyExecutable } from '../src/runtime-files.ts'

const roots: string[] = []

async function workdir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-kylin-files-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Runtime files', () => {
  it('resolves packaged files and an explicit development Runtime', () => {
    expect(resolveRuntimeFiles('/resources')).toEqual({
      executable: join('/resources', 'runtime', 'deepseek-harness-sdk-runtime-linux-arm64'),
      ripgrep: join('/resources', 'runtime', 'deepseek-harness-sdk-runtime-linux-arm64-rg'),
      patch: join('/resources', 'config', 'intranet.cordis.patch.yml'),
      skills: join('/resources', 'skills'),
      office: join('/resources', 'office'),
    })
    const override = resolveRuntimeFiles('/resources', './runtime-fixture')
    expect(override.ripgrep).toBe(`${override.executable}-rg`)
  })

  it('accepts an executable ARM64 ELF header', async () => {
    const path = join(await workdir(), 'runtime')
    const header = Buffer.alloc(20)
    header.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    header.writeUInt16LE(183, 18)
    await writeFile(path, header)
    await chmod(path, 0o755)
    await expect(verifyArm64Elf(path)).resolves.toBeUndefined()
    await expect(verifyExecutable(path)).resolves.toBeUndefined()
  })

  it('rejects a non-ARM64 file', async () => {
    const path = join(await workdir(), 'runtime')
    await writeFile(path, 'not an ELF')
    await expect(verifyArm64Elf(path)).rejects.toThrow(/AArch64 ELF/u)
  })
})
