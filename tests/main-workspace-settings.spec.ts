import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS_YAML, ensureInitialWorkspaceAndSettings, healSettingsYaml } from '../src/main.js'

describe('Workspace and settings self-healing', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'dsh-heal-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('healSettingsYaml', () => {
    it('heals anthropic-messages protocol to openai-completions for intranet-openai', () => {
      const input = `
llm-pi-ai:
  providers:
    - id: intranet-openai
      api: anthropic-messages
      baseURL: http://192.168.0.40:3000/v1
`
      const healed = healSettingsYaml(input)
      expect(healed).toContain('api: openai-completions')
      expect(healed).not.toContain('api: anthropic-messages')
    })

    it('normalizes baseURL missing /v1 on port 3000', () => {
      const input = `
llm-pi-ai:
  providers:
    - id: intranet-openai
      baseURL: http://192.168.0.40:3000
`
      const healed = healSettingsYaml(input)
      expect(healed).toContain('baseURL: http://192.168.0.40:3000/v1')
    })

    it('adds local-model alias when DeepSeek-V4-Flash-0731-w4a8 is present without it', () => {
      const input = `
agent-default-model:
  provider: intranet-openai
  model: local-model
llm-pi-ai:
  providers:
    - id: intranet-openai
      models:
        - id: DeepSeek-V4-Flash-0731-w4a8
          name: DeepSeek-V4-Flash-0731-w4a8
          contextWindow: 131072
          maxTokens: 8192
`
      const healed = healSettingsYaml(input)
      expect(healed).toContain('id: DeepSeek-V4-Flash-0731-w4a8')
      expect(healed).toContain('id: local-model')
      expect(healed).toContain('model: DeepSeek-V4-Flash-0731-w4a8')
    })
  })

  describe('ensureInitialWorkspaceAndSettings', () => {
    it('creates fresh workspace.json and settings.yaml when neither exists', () => {
      const dshHome = join(tempDir, 'runtime-home')
      const workspaceDir = join(tempDir, 'AgentWorkspace')
      mkdirSync(dshHome, { recursive: true })
      mkdirSync(workspaceDir, { recursive: true })

      ensureInitialWorkspaceAndSettings(dshHome, workspaceDir)

      const workspaceJsonPath = join(dshHome, 'storages', 'workspace.json')
      const settingsYamlPath = join(dshHome, 'settings.yaml')

      expect(existsSync(workspaceJsonPath)).toBe(true)
      expect(existsSync(settingsYamlPath)).toBe(true)

      const parsedWorkspace = JSON.parse(readFileSync(workspaceJsonPath, 'utf8'))
      expect(parsedWorkspace.unit.name).toBe('workspace')
      expect(parsedWorkspace.unit.version).toBe(2)
      expect(parsedWorkspace.global.initialized).toBe(true)
      expect(parsedWorkspace.global.workspaceIds.length).toBe(1)

      const id = parsedWorkspace.global.workspaceIds[0]
      const entry = parsedWorkspace.tables.workspaces[id]
      expect(entry.title).toBe('AgentWorkspace')
      expect(entry.sessionIds).toEqual([])

      const settingsText = readFileSync(settingsYamlPath, 'utf8')
      expect(settingsText).toContain('DeepSeek-V4-Flash-0731-w4a8')
      expect(settingsText).toContain('openai-completions')
    })

    it('heals an existing faulty settings.yaml in dshHome', () => {
      const dshHome = join(tempDir, 'runtime-home')
      const workspaceDir = join(tempDir, 'AgentWorkspace')
      mkdirSync(dshHome, { recursive: true })
      mkdirSync(workspaceDir, { recursive: true })

      const faultySettings = `
agent-default-model:
  provider: intranet-openai
  model: local-model
llm-pi-ai:
  providers:
    - id: intranet-openai
      api: anthropic-messages
      baseURL: http://192.168.0.40:3000
      models:
        - id: DeepSeek-V4-Flash-0731-w4a8
          name: DeepSeek-V4-Flash-0731-w4a8
          contextWindow: 131072
          maxTokens: 8192
`
      writeFileSync(join(dshHome, 'settings.yaml'), faultySettings, 'utf8')

      ensureInitialWorkspaceAndSettings(dshHome, workspaceDir)

      const healedSettings = readFileSync(join(dshHome, 'settings.yaml'), 'utf8')
      expect(healedSettings).toContain('api: openai-completions')
      expect(healedSettings).toContain('baseURL: http://192.168.0.40:3000/v1')
      expect(healedSettings).toContain('model: DeepSeek-V4-Flash-0731-w4a8')
      expect(healedSettings).toContain('id: local-model')
    })
  })
})
