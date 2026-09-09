import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('correctly applies SEA VFS compatibility patch to agent-presets discovery.ts', () => {
    const modulesDir = join(tempDir, 'packages/client/modules/src')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, 'index.ts'), sampleUpstreamIndexTs, 'utf8')

    const presetSrcDir = join(tempDir, 'packages/preset/agent-presets/src')
    const presetLibDir = join(tempDir, 'packages/preset/agent-presets/lib')
    mkdirSync(presetSrcDir, { recursive: true })
    mkdirSync(presetLibDir, { recursive: true })
    writeFileSync(join(presetLibDir, 'stale.js'), '// stale')

    const sampleDiscoveryTs = `
export async function scanRoot(root: PresetRoot, harnessBase: string): Promise<AgentPreset[]> {
  const dir = resolve(expandHomePath(root.path))
  let children = await readdir(dir, { withFileTypes: true })
  const found: AgentPreset[] = []
  for (const child of children) {
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
    const directory = join(dir, child.name)
    const path = join(directory, COMPOSITION_FILE)
    const metadata = await readPresetMetadata(directory)
    found.push({
      id: child.name, trust: root.trust, path, ...metadata,
      ...broken === undefined ? {} : { broken },
    })
  }
  return found.sort((left, right) => {
    const byOrder = (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY)
    return byOrder === 0 ? left.id.localeCompare(right.id) : byOrder
  })
}
`
    const discoveryFile = join(presetSrcDir, 'discovery.ts')
    writeFileSync(discoveryFile, sampleDiscoveryTs, 'utf8')

    const stdout = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout).toContain('successfully patched')

    const patched = readFileSync(discoveryFile, 'utf8')
    expect(patched).toContain("typeof child === 'string' ? child : child?.name")
    expect(patched).toContain("typeof child.isDirectory === 'function'")
    expect(patched).toContain('(await stat(join(dir, name)).catch(() => null))?.isDirectory() === true')
    expect(patched).toContain('id: name, trust: root.trust')
    expect(patched).toContain("(left.id || '').localeCompare(right.id || '')")

    // Stale lib/ removed
    expect(existsSync(join(presetLibDir, 'stale.js'))).toBe(false)
  })

  it('correctly applies self-healing default model patch to session-controller agent.ts', () => {
    const agentDir = join(tempDir, 'packages/api/session-controller/src')
    const agentLibDir = join(tempDir, 'packages/api/session-controller/lib')
    mkdirSync(agentDir, { recursive: true })
    mkdirSync(agentLibDir, { recursive: true })
    writeFileSync(join(agentLibDir, 'stale.js'), '// stale')

    const sampleAgentTs = `
export class SessionControllerHost {
  private agentOptions(): AgentOptions {
    const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
    return { provider, model }
  }

  async resumeObserved() {
    const session = await createSession({
      agentOptions: this.agentOptions(),
    })
  }

  async selectionFor() {
    const defaultModel = this.ctx.agentDefaultModel
    const selection: InstalledSelection = {
      get current(): AgentModelSelection {
        if (picked !== undefined) return picked
        const loggedHeader = agent.session.requestHeader()
        if (loggedHeader === undefined) return defaultModel.currentSelection()
        return loggedHeader
      },
    }
  }
}
`
    const agentFile = join(agentDir, 'agent.ts')
    writeFileSync(agentFile, sampleAgentTs, 'utf8')

    const stdout = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout).toContain('successfully patched')

    const patched = readFileSync(agentFile, 'utf8')
    expect(patched).toContain('private resolvedFallbackSelection?: AgentModelSelection')
    expect(patched).toContain('await llm.resolveModelInfo(selection.provider, selection.model)')
    expect(patched).toContain('void this.ctx.agentDefaultModel.saveSelection(fallback).catch(() => {})')
    expect(patched).toContain('const firstModel = models[0]')
    expect(patched).toContain('agentOptions: await this.agentOptions(),')
    expect(patched).toContain('const host = this')
    expect(patched).toContain('return host.resolvedFallbackSelection ?? defaultModel.currentSelection()')
    expect(existsSync(join(agentLibDir, 'stale.js'))).toBe(false)
  })

  it('correctly applies candidateUrls fallback patch to llm-pi-ai discovery.ts', () => {
    const discoveryDir = join(tempDir, 'packages/llm/llm-pi-ai/src')
    const discoveryLibDir = join(tempDir, 'packages/llm/llm-pi-ai/lib')
    mkdirSync(discoveryDir, { recursive: true })
    mkdirSync(discoveryLibDir, { recursive: true })
    writeFileSync(join(discoveryLibDir, 'stale.js'), '// stale')

    const sampleDiscoveryTs = `
export async function discoverModels(request: ModelDiscoveryRequest): Promise<DiscoveredModel[]> {
  const url = listingUrl(request.baseURL, api)
  // A key typed into the form wins: it may replace the stored key that is
  // failing. The stored profile is asked past the catalog and protocol checks,
  // and its credential resolver remains lazy so a typed key cannot fail over a
  // stored credential it supersedes. A route may still authenticate through a
  // deployment-owned Authorization header when neither key exists.
  const stored = storedProfile?.()
  const supplied = request.apiKey ?? await stored?.resolveApiKey()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response: Response
  try {
    const headers = new Headers(stored?.headers === undefined ? undefined : Object.entries(stored.headers))
    headers.set('accept', 'application/json')
    if (api === 'anthropic-messages') {
      headers.set('anthropic-version', ANTHROPIC_VERSION)
      if (apiKey !== undefined) headers.set('x-api-key', apiKey)
    } else if (apiKey !== undefined) {
      headers.set('authorization', \`Bearer \${apiKey}\`)
    }
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    response = await fetch(url, {
      method: 'GET',
      headers,
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(\`could not reach \${url}\`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      \`\${url} answered \${response.status}\${response.status === 401 || response.status === 403 ? '; check the API key' : ''}\`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(\`\${url} did not answer with JSON\`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body)
}
`
    const discoveryFile = join(discoveryDir, 'discovery.ts')
    writeFileSync(discoveryFile, sampleDiscoveryTs, 'utf8')

    const stdout = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout).toContain('successfully patched')

    const patched = readFileSync(discoveryFile, 'utf8')
    expect(patched).toContain('const candidateUrls = [primaryUrl]')
    expect(patched).toContain("candidateUrls.push(`${baseClean}/v1/models`)")
    expect(patched).toContain('for (const url of candidateUrls)')
    expect(existsSync(join(discoveryLibDir, 'stale.js'))).toBe(false)
  })

  it('correctly applies logging patch to ui-conversation ConversationRoot.tsx', () => {
    const rootDir = join(tempDir, 'packages/client/ui-conversation/src/client/skeleton')
    const rootLibDir = join(tempDir, 'packages/client/ui-conversation/lib')
    mkdirSync(rootDir, { recursive: true })
    mkdirSync(rootLibDir, { recursive: true })
    writeFileSync(join(rootLibDir, 'stale.js'), '// stale')

    const sampleConversationRootTsx = `
        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },
`
    const rootFile = join(rootDir, 'ConversationRoot.tsx')
    writeFileSync(rootFile, sampleConversationRootTsx, 'utf8')

    const stdout = execFileSync(process.execPath, [patchScript, tempDir], { encoding: 'utf8' })
    expect(stdout).toContain('successfully patched')

    const patched = readFileSync(rootFile, 'utf8')
    expect(patched).toContain("console.error('[ui-conversation] selectWorkspace failed:', error)")
    expect(existsSync(join(rootLibDir, 'stale.js'))).toBe(false)
  })
})
