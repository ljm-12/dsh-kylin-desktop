#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sourceDir = process.argv[2]
if (!sourceDir) {
  console.error('usage: node patch-upstream-client-modules.mjs <official-source-dir>')
  process.exit(1)
}

function patchClientModules(sourceDir) {
  const targetPath = resolve(sourceDir, 'packages/client/modules/src/index.ts')
  if (!existsSync(targetPath)) {
    console.log(`patch-upstream-client-modules: target file not found at ${targetPath}, skipping.`)
    return
  }

  let code = readFileSync(targetPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('resolveLoaderShape') && code.includes('moduleFallbackTarget')) {
    console.log('patch-upstream-client-modules: already patched, skipping.')
    return
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
  private resolveLoaderShape(internal: NonNullable<Context['loader']['internal']>): 'v1' | 'v2' {
    if (this.loaderShape !== undefined) return this.loaderShape
    const shape: 'v1' | 'v2' = 'getOrCreateModuleJob' in internal
      ? 'v2'
      : 'getModuleJobForImport' in internal
        ? 'v1'
        : this.probeLoaderShape(internal)
    this.loaderShape = shape
    return shape
  }

  private probeLoaderShape(internal: NonNullable<Context['loader']['internal']>): 'v1' | 'v2' {
    try {
      ;(internal as any).resolveSync('node:os', 'file:///probe', {})
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
    const dshObj = dsh as Record<string, any> | undefined
    const moduleFallbackTargets = dshObj?.moduleFallback?.targets as Record<string, any> | undefined
    const moduleFallbackTarget = typeof moduleFallbackTargets?.['.'] === 'string'
      ? (moduleFallbackTargets['.'] as string)
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
}

// 6. Patch agent-presets discovery.ts for SEA VFS string/Dirent compatibility
function patchAgentPresetsDiscovery(sourceDir) {
  const discoveryPath = resolve(sourceDir, 'packages/preset/agent-presets/src/discovery.ts')
  if (!existsSync(discoveryPath)) {
    console.log(`patch-upstream: discovery file not found at ${discoveryPath}, skipping preset patch.`)
    return
  }

  let code = readFileSync(discoveryPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes("typeof child === 'string' ? child : child?.name") && code.includes('id: name, trust: root.trust')) {
    console.log('patch-upstream: discovery.ts already patched, skipping.')
    return
  }

  const needle1 = `  for (const child of children) {
    if (!child.isDirectory() || !PRESET_ID.test(child.name)) continue
    const directory = join(dir, child.name)`

  const replacement1 = `  for (const child of children) {
    const name = typeof child === 'string' ? child : child?.name
    if (typeof name !== 'string' || !PRESET_ID.test(name)) continue
    const isDir = typeof child === 'object' && child !== null && typeof child.isDirectory === 'function'
      ? child.isDirectory()
      : (await stat(join(dir, name)).catch(() => null))?.isDirectory() === true
    if (!isDir) continue
    const directory = join(dir, name)`

  if (!code.includes(needle1) && !code.includes("typeof child === 'string' ? child : child?.name")) {
    console.warn('patch-upstream: could not find scanRoot needle in discovery.ts')
    return
  }

  if (code.includes(needle1)) {
    code = code.replace(needle1, replacement1)
  }

  const needle2 = `    found.push({
      id: child.name, trust: root.trust, path, ...metadata,`

  const replacement2 = `    found.push({
      id: name, trust: root.trust, path, ...metadata,`

  if (code.includes(needle2)) {
    code = code.replace(needle2, replacement2)
  }

  const needle3 = `return byOrder === 0 ? left.id.localeCompare(right.id) : byOrder`
  const replacement3 = `return byOrder === 0 ? (left.id || '').localeCompare(right.id || '') : byOrder`
  if (code.includes(needle3)) {
    code = code.replace(needle3, replacement3)
  }

  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(discoveryPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${discoveryPath}`)

  const staleLibDir = join(sourceDir, 'packages/preset/agent-presets/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 7. Patch session-controller agent.ts for self-healing default model resolution
function patchSessionControllerAgent(sourceDir) {
  const agentPath = resolve(sourceDir, 'packages/api/session-controller/src/agent.ts')
  if (!existsSync(agentPath)) {
    console.log(`patch-upstream: agent file not found at ${agentPath}, skipping session-controller patch.`)
    return
  }

  let code = readFileSync(agentPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('resolvedFallbackSelection')) {
    console.log('patch-upstream: agent.ts already patched, skipping.')
    return
  }

  const needleOptions = `  private agentOptions(): AgentOptions {
    const { provider, model } = this.ctx.agentDefaultModel.currentSelection()
    return { provider, model }
  }`

  const replacementOptions = `  private resolvedFallbackSelection?: AgentModelSelection

  private async agentOptions(): Promise<AgentOptions> {
    const selection = this.ctx.agentDefaultModel.currentSelection()
    const llm = this.ctx.llm
    if (llm !== undefined) {
      try {
        await llm.resolveModelInfo(selection.provider, selection.model)
        return { provider: selection.provider, model: selection.model }
      } catch {
        try {
          const providers = llm.listProviders?.() ?? []
          for (const provider of providers) {
            try {
              const models = await llm.listModels(provider.id)
              const firstModel = models[0]
              if (firstModel !== undefined) {
                const fallback: AgentModelSelection = { provider: provider.id, model: firstModel.id }
                this.resolvedFallbackSelection = fallback
                void this.ctx.agentDefaultModel.saveSelection(fallback).catch(() => {})
                return fallback
              }
            } catch {
              continue
            }
          }
        } catch {
          // Fallback discovery failed
        }
      }
    }
    return { provider: selection.provider, model: selection.model }
  }`

  if (!code.includes(needleOptions)) {
    console.warn('patch-upstream: could not find agentOptions needle in agent.ts')
    return
  }

  code = code.replace(needleOptions, replacementOptions)
  // Replace the 3 call sites: resumeObserved, createOrAdopt (resume), createOrAdopt (create)
  code = code.replaceAll('agentOptions: this.agentOptions(),', 'agentOptions: await this.agentOptions(),')

  const needleSelection = `    const defaultModel = this.ctx.agentDefaultModel
    const selection: InstalledSelection = {
      get current(): AgentModelSelection {
        if (picked !== undefined) return picked
        const loggedHeader = agent.session.requestHeader()
        if (loggedHeader === undefined) return defaultModel.currentSelection()`

  const replacementSelection = `    const defaultModel = this.ctx.agentDefaultModel
    const host = this
    const selection: InstalledSelection = {
      get current(): AgentModelSelection {
        if (picked !== undefined) return picked
        const loggedHeader = agent.session.requestHeader()
        if (loggedHeader === undefined) return host.resolvedFallbackSelection ?? defaultModel.currentSelection()`

  if (code.includes(needleSelection)) {
    code = code.replace(needleSelection, replacementSelection)
  }

  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(agentPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${agentPath}`)

  const staleLibDir = join(sourceDir, 'packages/api/session-controller/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 8. Patch llm-pi-ai discovery.ts to automatically fall back to /v1/models for OpenAI-compatible endpoints
function patchLlmDiscovery(sourceDir) {
  const discoveryPath = resolve(sourceDir, 'packages/llm/llm-pi-ai/src/discovery.ts')
  if (!existsSync(discoveryPath)) {
    console.log(`patch-upstream: discovery file not found at ${discoveryPath}, skipping llm discovery patch.`)
    return
  }

  let code = readFileSync(discoveryPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('candidateUrls')) {
    console.log('patch-upstream: discovery.ts already patched, skipping.')
    return
  }

  const needle = `  const url = listingUrl(request.baseURL, api)
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
  return readListing(body)`

  const replacement = `  const primaryUrl = listingUrl(request.baseURL, api)
  const candidateUrls = [primaryUrl]
  if (api !== 'anthropic-messages') {
    const baseClean = request.baseURL.replace(/\\/+$/, '')
    if (!baseClean.endsWith('/v1')) {
      candidateUrls.push(\`\${baseClean}/v1/models\`)
    }
  }

  let lastError: unknown
  for (const url of candidateUrls) {
    try {
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
        const reason = error instanceof Error ? \`: \${error.message}\` : ''
        throw new LlmError(\`could not reach \${url}\${reason}\`, 'DISCOVERY_FAILED', { cause: error })
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
    } catch (error) {
      lastError = error
      if (candidateUrls.indexOf(url) < candidateUrls.length - 1) {
        continue
      }
      throw error
    }
  }
  throw lastError`

  if (!code.includes(needle)) {
    console.warn('patch-upstream: could not find discoverModels needle in discovery.ts')
    return
  }

  code = code.replace(needle, replacement)
  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(discoveryPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${discoveryPath}`)

  const staleLibDir = join(sourceDir, 'packages/llm/llm-pi-ai/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 9. Patch ui-conversation ConversationRoot.tsx for observable workspace selection failure logging
function patchUiConversationRoot(sourceDir) {
  const rootPath = resolve(sourceDir, 'packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx')
  if (!existsSync(rootPath)) {
    console.log(`patch-upstream: ConversationRoot file not found at ${rootPath}, skipping ui-conversation patch.`)
    return
  }

  let code = readFileSync(rootPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('selectWorkspace failed:')) {
    console.log('patch-upstream: ConversationRoot.tsx already patched, skipping.')
    return
  }

  const needle = `        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch(() => {
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },`

  const replacement = `        onPick: (workspaceId) => {
          setPickerOpen(false)
          setPendingWorkspaceId(workspaceId)
          void selectWorkspace(workspaceId).catch((error) => {
            console.error('[ui-conversation] selectWorkspace failed:', error)
            setPendingWorkspaceId(current => current === workspaceId ? undefined : current)
          })
        },`

  if (!code.includes(needle)) {
    console.warn('patch-upstream: could not find onPick needle in ConversationRoot.tsx')
    return
  }

  code = code.replace(needle, replacement)
  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(rootPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${rootPath}`)

  const staleLibDir = join(sourceDir, 'packages/client/ui-conversation/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 10. Patch ui-sidebar SidebarRoot.module.css to hide redundant brand logo in desktop window
function patchUiSidebar(sourceDir) {
  const cssPath = resolve(sourceDir, 'packages/client/ui-sidebar/src/client/SidebarRoot.module.css')
  if (!existsSync(cssPath)) {
    console.log(`patch-upstream: SidebarRoot.module.css not found at ${cssPath}, skipping ui-sidebar patch.`)
    return
  }

  let code = readFileSync(cssPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('.brand {\n  display: none;')) {
    console.log('patch-upstream: SidebarRoot.module.css already patched, skipping.')
    return
  }

  const needle = `.brand {
  flex: 1;`

  const replacement = `.brand {
  display: none;
  flex: 1;`

  if (!code.includes(needle)) {
    console.warn('patch-upstream: could not find .brand needle in SidebarRoot.module.css')
    return
  }

  code = code.replace(needle, replacement)

  const needleLogoRow = `.logoRow {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  height: 60px;
  padding: 8px 0 8px 4px;
  margin-bottom: 8px;`

  const replacementLogoRow = `.logoRow {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  height: 40px;
  padding: 4px 0 4px 4px;
  margin-bottom: 4px;`

  if (code.includes(needleLogoRow)) {
    code = code.replace(needleLogoRow, replacementLogoRow)
  }

  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(cssPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${cssPath}`)

  const staleLibDir = join(sourceDir, 'packages/client/ui-sidebar/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 11. Patch ui-attachment ComposerAttachments.tsx for Linux desktop drag-and-drop and unfreezable drop overlay
function patchUiAttachment(sourceDir) {
  const filePath = resolve(sourceDir, 'packages/client/ui-attachment/src/client/ComposerAttachments.tsx')
  if (!existsSync(filePath)) {
    console.log(`patch-upstream: ComposerAttachments.tsx not found at ${filePath}, skipping ui-attachment patch.`)
    return
  }

  let code = readFileSync(filePath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes("window.addEventListener('keydown', onKeyDown)") && code.includes('event.preventDefault()\n      reset()')) {
    console.log('patch-upstream: ComposerAttachments.tsx already patched, skipping.')
    return
  }

  const needleTransfer = `    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }`

  const replacementTransfer = `    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || (!dataTransfer.types.includes('Files') && !dataTransfer.types.includes('text/uri-list'))) return null
      return dataTransfer
    }`

  if (!code.includes(needleTransfer)) {
    console.warn('patch-upstream: could not find fileTransfer needle in ComposerAttachments.tsx')
    return
  }

  code = code.replace(needleTransfer, replacementTransfer)

  const needleDrop = `    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (canAcceptDrop) onAddFiles([...dataTransfer.files])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }`

  const replacementDrop = `    const onDrop = (event: globalThis.DragEvent): void => {
      event.preventDefault()
      reset()
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      if (canAcceptDrop && dataTransfer.files && dataTransfer.files.length > 0) {
        onAddFiles([...dataTransfer.files])
      }
    }
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') reset()
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', reset)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('click', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', reset)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('click', reset)
    }`

  if (code.includes(needleDrop)) {
    code = code.replace(needleDrop, replacementDrop)
  }

  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(filePath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${filePath}`)

  const staleLibDir = join(sourceDir, 'packages/client/ui-attachment/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 12. Patch ui-conversation InputBar.tsx for direct native file picker integration
function patchUiConversationInputBar(sourceDir) {
  const inputBarPath = resolve(sourceDir, 'packages/client/ui-conversation/src/client/skeleton/InputBar.tsx')
  if (!existsSync(inputBarPath)) {
    console.log(`patch-upstream: InputBar file not found at ${inputBarPath}, skipping InputBar patch.`)
    return
  }

  let code = readFileSync(inputBarPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes("style={{ position: 'fixed', top: -9999")) {
    console.log('patch-upstream: InputBar.tsx already patched, skipping.')
    return
  }

  const needle = `            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={subagent !== null}
              hidden
              onChange={onPickFiles}
            />`

  const replacement = `            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={subagent !== null}
              style={{ position: 'fixed', top: -9999, left: -9999, opacity: 0, width: 1, height: 1, pointerEvents: 'none' }}
              aria-hidden="true"
              tabIndex={-1}
              onChange={onPickFiles}
            />`

  if (!code.includes(needle)) {
    console.warn('patch-upstream: could not find file input needle in InputBar.tsx')
    return
  }

  code = code.replace(needle, replacement)

  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(inputBarPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${inputBarPath}`)

  const staleLibDir = join(sourceDir, 'packages/client/ui-conversation/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

// 13. Patch llm-pi-ai index.ts to seamlessly resolve intranet credentials from UI store and environment
function patchLlmPiAiApiKeyResolution(sourceDir) {
  const targetPath = resolve(sourceDir, 'packages/llm/llm-pi-ai/src/index.ts')
  if (!existsSync(targetPath)) {
    console.log(`patch-upstream: llm-pi-ai index.ts not found at ${targetPath}, skipping.`)
    return
  }

  let code = readFileSync(targetPath, 'utf8')
  const isCRLF = code.includes('\r\n')
  code = code.replace(/\r\n/g, '\n')

  if (code.includes('INTRANET_OPENAI_API_KEY') && code.includes('altRef')) {
    console.log('patch-upstream: llm-pi-ai index.ts already patched, skipping.')
    return
  }

  const needle = `  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai \`undefined\` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)`

  const replacement = `  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const defaultRef = provider === 'intranet-openai' ? 'INTRANET_OPENAI_API_KEY' : undefined
    const ref = profile.apiKeyEnv ?? defaultRef
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    let hit = credentials !== undefined
      ? (await credentials.resolve(ref as any))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref as any)?.value
    if ((hit === undefined || hit.length === 0) && (ref === 'INTRANET_AGENT_API_KEY' || ref === 'INTRANET_OPENAI_API_KEY')) {
      const altRef = ref === 'INTRANET_AGENT_API_KEY' ? 'INTRANET_OPENAI_API_KEY' : 'INTRANET_AGENT_API_KEY'
      hit = credentials !== undefined
        ? (await credentials.resolve(altRef as any))?.value
        : launchEnvironmentOf(ctx).get(altRef as any)?.value
    }
    if (hit === undefined || hit.length === 0) {
      hit = process.env[ref] ?? (ref === 'INTRANET_AGENT_API_KEY' ? process.env.INTRANET_OPENAI_API_KEY : process.env.INTRANET_AGENT_API_KEY)
    }
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref as any)`

  if (!code.includes(needle)) {
    console.warn('patch-upstream: could not find resolveApiKey needle in llm-pi-ai index.ts')
    return
  }

  code = code.replace(needle, replacement)
  if (isCRLF) {
    code = code.replace(/\n/g, '\r\n')
  }

  writeFileSync(targetPath, code, 'utf8')
  console.log(`patch-upstream: successfully patched ${targetPath}`)

  const staleLibDir = join(sourceDir, 'packages/llm/llm-pi-ai/lib')
  if (existsSync(staleLibDir)) {
    console.log(`patch-upstream: removing stale ${staleLibDir}`)
    rmSync(staleLibDir, { recursive: true, force: true })
  }
}

patchClientModules(sourceDir)
patchAgentPresetsDiscovery(sourceDir)
patchSessionControllerAgent(sourceDir)
patchLlmDiscovery(sourceDir)
patchLlmPiAiApiKeyResolution(sourceDir)
patchUiConversationRoot(sourceDir)
patchUiSidebar(sourceDir)
patchUiAttachment(sourceDir)
patchUiConversationInputBar(sourceDir)
