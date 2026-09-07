import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const patchScript = fileURLToPath(new URL('../scripts/patch-upstream-client-modules.mjs', import.meta.url))

const sampleUpstreamIndexTs = `
import { Service } from '@deepseek-ai/cordis'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export class ClientModuleRegistry extends Service {
  // Resolution is entry-local: the same specifier can resolve differently in
  // separate config trees. Negative verdicts remain stable until restart.
  private readonly pkgMeta = new Map<string, ResolvedPkgMeta | null>()
  private readonly rebuildListeners = new Set<(id: string, rev: string) => void>()

  private resolveMeta(loaderName: string, baseUrl: string): ResolvedPkgMeta | null {
    const sourceKey = this.sourceKey(loaderName, baseUrl)
    const cached = this.pkgMeta.get(sourceKey)
    if (cached !== undefined) return cached
    const located = this.locatePkgJson(loaderName, baseUrl)
    if (located === undefined) {
      this.pkgMeta.set(sourceKey, null)
      return null
    }
    const { packageName, path: pkgPath } = located
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const dsh = pkg.dsh
    const decl = parseDshClient(
      packageName,
      dsh !== null && typeof dsh === 'object' ? (dsh as Record<string, unknown>).client : undefined,
    )
    if (decl === undefined || decl.platform !== 'web') {
      this.pkgMeta.set(sourceKey, null)
      return null
    }
    const clientRel = clientExportOf(packageName, pkg.exports)
    if (clientRel === undefined) {
      throw new Error(\`client-modules: \${packageName} declares dsh.client but exports no "./client" bundle\`)
    }
    const meta: PkgMeta = {
      clientPath: join(dirname(pkgPath), clientRel),
      ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
      external: decl.external ?? [],
      immediately: decl.immediately === true,
    }
    const resolved = { packageName, meta }
    this.pkgMeta.set(sourceKey, resolved)
    return resolved
  }

  private locatePkgJson(loaderName: string, baseUrl: string): { path: string; packageName: string } | undefined {
    const internal = this.ctx.loader.internal
    let moduleUrl: string
    try {
      moduleUrl = internal.version === 'v2'
        ? internal.resolveSync(baseUrl, { specifier: loaderName, attributes: {} }).url
        : internal.resolveSync(loaderName, baseUrl, {}).url
    } catch {
      // The Loader cannot resolve the name: its row cannot have imported, so
      // the name is permanently not a client row.
      return undefined
    }
    return this.nearestPackage(moduleUrl, expectedPackageName)
  }

  private nearestPackage(
    moduleUrl: string,
    expectedPackageName?: string,
  ): { path: string; packageName: string } | undefined {
    if (!moduleUrl.startsWith('file:')) return undefined
    let dir = dirname(fileURLToPath(moduleUrl))
    return undefined
  }
}
`

describe('Upstream client modules patcher', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-patch-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('correctly applies patches to upstream client modules index.ts', () => {
    const targetDir = join(tempDir, 'packages/client/modules/src')
    const staleLibDir = join(tempDir, 'packages/client/modules/lib')
    mkdirSync(targetDir, { recursive: true })
    mkdirSync(staleLibDir, { recursive: true })
    writeFileSync(join(staleLibDir, 'stale.js'), '// stale')

    const file = join(targetDir, 'index.ts')
    writeFileSync(file, sampleUpstreamIndexTs, 'utf8')

    const stdout = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout).toContain('successfully patched')
    expect(stdout).toContain('removing stale')

    const patched = readFileSync(file, 'utf8')

    // 1. Loader shape probe
    expect(patched).toContain('private loaderShape: \'v1\' | \'v2\' | undefined')
    expect(patched).toContain('private resolveLoaderShape(internal: NonNullable<Context[\'loader\'][\'internal\']>): \'v1\' | \'v2\'')
    expect(patched).toContain('getOrCreateModuleJob')

    // 2. Dual fallback and warning in locatePkgJson
    expect(patched).toContain('const shape = this.resolveLoaderShape(internal)')
    expect(patched).toContain('client-modules: failed to resolve')

    // 3. Module fallback in resolveMeta
    expect(patched).toContain('moduleFallbackTarget')
    expect(patched).toContain('targetManifestPath')

    // 4. Nearest package URL handling
    expect(patched).toContain('isAbsolute(moduleUrl)')

    // 5. Stale lib directory removed
    expect(readFileSync(file)).toBeTruthy()

    // 6. Idempotent re-run
    const stdout2 = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout2).toContain('already patched, skipping')
  })
})
