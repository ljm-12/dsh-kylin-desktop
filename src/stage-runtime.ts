import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RIPGREP_BASENAME, RUNTIME_BASENAME, verifyArm64Elf } from './runtime-files.js'

interface BuildInfo {
  sourceRepository: 'https://github.com/deepseek-ai/deepseek-harness'
  sourceRef: string
  sourceCommit: string
  repositoryVersion: string
  runtimeSha256: string
  ripgrepSha256: string
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`stage-runtime: --${name} is required.`)
  return value
}

/** Stage an exact official ARM64 Runtime and its sidecar for electron-builder. */
export async function stageRuntime(
  packageRoot: string,
  sourceDir: string,
  facts: Omit<BuildInfo, 'sourceRepository' | 'runtimeSha256' | 'ripgrepSha256'>,
): Promise<BuildInfo> {
  const runtimeRoot = resolve(packageRoot, 'runtime')
  if (runtimeRoot !== join(resolve(packageRoot), 'runtime')) throw new Error(`stage-runtime: unsafe target ${runtimeRoot}`)
  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true, mode: 0o755 })
  const runtimeSource = resolve(sourceDir, RUNTIME_BASENAME)
  const ripgrepSource = resolve(sourceDir, RIPGREP_BASENAME)
  await verifyArm64Elf(runtimeSource)
  await verifyArm64Elf(ripgrepSource)
  const runtimeTarget = join(runtimeRoot, RUNTIME_BASENAME)
  const ripgrepTarget = join(runtimeRoot, RIPGREP_BASENAME)
  await copyFile(runtimeSource, runtimeTarget)
  await copyFile(ripgrepSource, ripgrepTarget)
  await chmod(runtimeTarget, 0o755)
  await chmod(ripgrepTarget, 0o755)
  const info: BuildInfo = {
    sourceRepository: 'https://github.com/deepseek-ai/deepseek-harness',
    ...facts,
    runtimeSha256: await sha256(runtimeTarget),
    ripgrepSha256: await sha256(ripgrepTarget),
  }
  await writeFile(join(runtimeRoot, 'BUILD-INFO.json'), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o644 })
  return info
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const { values } = parseArgs({
    args,
    options: {
      'source-dir': { type: 'string' },
      'source-ref': { type: 'string' },
      'source-commit': { type: 'string' },
      'repository-version': { type: 'string' },
    },
  })
  const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const info = await stageRuntime(packageRoot, required(values['source-dir'], 'source-dir'), {
    sourceRef: required(values['source-ref'], 'source-ref'),
    sourceCommit: required(values['source-commit'], 'source-commit'),
    repositoryVersion: required(values['repository-version'], 'repository-version'),
  })
  console.log(`stage-runtime: ${basename(packageRoot)} ${info.repositoryVersion} ${info.sourceCommit}`)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
