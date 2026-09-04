import { constants } from 'node:fs'
import { access, lstat, open } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const RUNTIME_BASENAME = 'deepseek-harness-sdk-runtime-linux-arm64'
export const RIPGREP_BASENAME = `${RUNTIME_BASENAME}-rg`

/** Fixed files the packaged desktop carrier requires. */
export interface RuntimeFiles {
  executable: string
  ripgrep: string
  patch: string
  skills: string
  office: string
}

/** Resolve packaged Runtime files, with an explicit development override. */
export function resolveRuntimeFiles(resourcesPath: string, runtimeOverride?: string): RuntimeFiles {
  const executable = runtimeOverride === undefined || runtimeOverride.trim() === ''
    ? join(resourcesPath, 'runtime', RUNTIME_BASENAME)
    : resolve(runtimeOverride)
  return {
    executable,
    ripgrep: `${executable}-rg`,
    patch: join(resourcesPath, 'config', 'intranet.cordis.patch.yml'),
    skills: join(resourcesPath, 'skills'),
    office: join(resourcesPath, 'office'),
  }
}

/** Verify a regular, non-symlink executable before spawning it. */
export async function verifyExecutable(path: string): Promise<void> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected a regular non-symlink file: ${path}`)
  await access(path, constants.X_OK)
}

/** Verify that a file is a little-endian 64-bit AArch64 ELF. */
export async function verifyArm64Elf(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(20)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (bytesRead < bytes.length
      || bytes[0] !== 0x7f
      || bytes[1] !== 0x45
      || bytes[2] !== 0x4c
      || bytes[3] !== 0x46
      || bytes[4] !== 2
      || bytes[5] !== 1
      || bytes.readUInt16LE(18) !== 183) {
      throw new Error(`Expected a little-endian 64-bit AArch64 ELF: ${path}`)
    }
  } finally {
    await handle.close()
  }
}
