#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sourceDir = process.argv[2]
if (!sourceDir) {
  console.error('usage: node patch-upstream-client-modules.mjs <official-source-dir>')
  process.exit(1)
}

const targetPath = resolve(sourceDir, 'packages/client/modules/src/index.ts')
if (!existsSync(targetPath)) {
  console.error(`patch-upstream-client-modules: target file not found at ${targetPath}`)
  process.exit(1)
}

let code = readFileSync(targetPath, 'utf8')
const isCRLF = code.includes('\r\n')
code = code.replace(/\r\n/g, '\n')

if (code.includes('resolveLoaderShape') && code.includes('moduleFallbackTarget')) {
  console.log('patch-upstream-client-modules: already patched, skipping.')
  process.exit(0)
}

// 1. Add loaderShape state and probe methods
const needle1 = `  // Resolution is entry-local: the same specifier can resolve differently in
  // separate config trees. Negative verdicts remain stable until restart.
  private readonly pkgMeta = new Map<string, ResolvedPkgMeta | null>()`

const replacement1 = `  // Resolution is entry-local: the same specifier can resolve differently in
  // separate config trees. Negative verdicts remain stable until restart.
  private readonly pkgMeta = new Map<string, ResolvedPkgMeta | null>()
  /** Cached Node internal loader resolveSync shape (v1: \`(specifier, parentURL, attrs)\`, v2: \`(parentURL, request)\`). */
  private loaderShape: 'v1' | 'v2' | undefined

  /**
   * Detect the Node internal loader resolveSync shape once per process.
   * The v2 API surface (\`getOrCreateModuleJob\`) exists from Node 24.12.0;
   * older loaders expose \`getModuleJobForImport\`. A loader exposing neither
   * is probed by calling with the v1 argument order, which the v2 signature
   * rejects (discussions #4885, #4968, #4955).
   */
  private resolveLoaderShape(internal: any): 'v1' | 'v2' {
    if (this.loaderShape !== undefined) return this.loaderShape
    const shape: 'v1' | 'v2' = 'getOrCreateModuleJob' in internal
      ? 'v2'
      : 'getModuleJobForImport' in internal
        ? 'v1'
        : this.probeLoaderShape(internal)
    this.loaderShape = shape
    return shape
  }

  private probeLoaderShape(internal: any): 'v1' | 'v2' {
    try {
      internal.resolveSync('node:os', 'file:///probe', {})
      return 'v1'
    } catch {
      return 'v2'
    }
  }`

if (!code.includes(needle1)) {
  console.error('patch-upstream-client-modules: failed to find needle 1 in ClientModuleRegistry')
  process.exit(1)
}
code = code.replace(needle1, replacement1)

// 2. Patch locatePkgJson with loader shape probe, dual fallback, and warning on failure
const needle2 = `    let moduleUrl: string
    try {
      moduleUrl = internal.version === 'v2'
        ? internal.resolveSync(baseUrl, { specifier: loaderName, attributes: {} }).url
        : internal.resolveSync(loaderName, baseUrl, {}).url
    } catch {
      // The Loader cannot resolve the name: its row cannot have imported, so
      // the name is permanently not a client row.
      return undefined
    }`

const replacement2 = `    let moduleUrl: string
    try {
      const shape = this.resolveLoaderShape(internal)
      if (shape === 'v2') {
        try {
          moduleUrl = (internal as any).resolveSync(baseUrl, { specifier: loaderName, attributes: {} }).url
        } catch {
          moduleUrl = (internal as any).resolveSync(loaderName, baseUrl, {}).url
        }
      } else {
        try {
          moduleUrl = (internal as any).resolveSync(loaderName, baseUrl, {}).url
        } catch {
          moduleUrl = (internal as any).resolveSync(baseUrl, { specifier: loaderName, attributes: {} }).url
        }
      }
    } catch (error) {
      // The Loader cannot resolve the name: its row cannot have imported, so
      // the name is permanently not a client row. Warn once per name+tree —
      // the negative verdict is cached below, and a silent null here previously
      // left an empty client table with no server-side trace.
      this.ctx.logger?.warn?.(
        \`client-modules: failed to resolve \${loaderName} from \${baseUrl}: \${error instanceof Error ? error.message : String(error)}\`,
      )
      return undefined
    }`

if (!code.includes(needle2)) {
  console.error('patch-upstream-client-modules: failed to find needle 2 in locatePkgJson')
  process.exit(1)
}
code = code.replace(needle2, replacement2)

// 3. Patch resolveMeta to follow moduleFallback proxy targets in SEA environments
const needle3 = `    const { packageName, path: pkgPath } = located
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
    }`

const replacement3 = `    const { packageName, path: pkgPath } = located
    let targetManifestPath = pkgPath
    let pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    let dsh = pkg.dsh
    const moduleFallbackTarget = (dsh && typeof dsh === 'object' && (dsh as Record<string, unknown>).moduleFallback && typeof (dsh as Record<string, unknown>).moduleFallback === 'object')
      ? ((dsh as Record<string, unknown>).moduleFallback as Record<string, unknown>)?.targets?.['.']
      : undefined
    if (typeof moduleFallbackTarget === 'string') {
      const fallbackUrl = moduleFallbackTarget.startsWith('file:') ? moduleFallbackTarget : pathToFileURL(moduleFallbackTarget).href
      const fallbackLocated = this.nearestPackage(fallbackUrl, packageName)
      if (fallbackLocated !== undefined) {
        targetManifestPath = fallbackLocated.path
        pkg = JSON.parse(readFileSync(targetManifestPath, 'utf8')) as Record<string, unknown>
        dsh = pkg.dsh
      }
    }
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
      clientPath: join(dirname(targetManifestPath), clientRel),
      ...(decl.inject !== undefined ? { inject: decl.inject } : {}),
      external: decl.external ?? [],
      immediately: decl.immediately === true,
    }`

if (!code.includes(needle3)) {
  console.error('patch-upstream-client-modules: failed to find needle 3 in resolveMeta')
  process.exit(1)
}
code = code.replace(needle3, replacement3)

// 4. Patch nearestPackage to accept URLs and absolute snapshot paths
const needle4 = `  private nearestPackage(
    moduleUrl: string,
    expectedPackageName?: string,
  ): { path: string; packageName: string } | undefined {
    if (!moduleUrl.startsWith('file:')) return undefined
    let dir = dirname(fileURLToPath(moduleUrl))`

const replacement4 = `  private nearestPackage(
    moduleUrl: string,
    expectedPackageName?: string,
  ): { path: string; packageName: string } | undefined {
    const fileUrl = moduleUrl.startsWith('file:')
      ? moduleUrl
      : isAbsolute(moduleUrl)
        ? pathToFileURL(moduleUrl).href
        : undefined
    if (fileUrl === undefined) return undefined
    let dir = dirname(fileURLToPath(fileUrl))`

if (!code.includes(needle4)) {
  console.error('patch-upstream-client-modules: failed to find needle 4 in nearestPackage')
  process.exit(1)
}
code = code.replace(needle4, replacement4)

if (isCRLF) {
  code = code.replace(/\n/g, '\r\n')
}

writeFileSync(targetPath, code, 'utf8')
console.log(`patch-upstream-client-modules: successfully patched ${targetPath}`)

// 5. Remove stale lib/ build output if present so pnpm build recompiles clean
const staleLibDir = join(sourceDir, 'packages/client/modules/lib')
if (existsSync(staleLibDir)) {
  console.log(`patch-upstream-client-modules: removing stale ${staleLibDir}`)
  rmSync(staleLibDir, { recursive: true, force: true })
}
