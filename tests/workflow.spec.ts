import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const buildWorkflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/build-kylin-arm64-desktop.yml', import.meta.url)),
  'utf8',
)

const testWorkflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/test-kylin-desktop.yml', import.meta.url)),
  'utf8',
)

describe('Kylin native build workflow', () => {
  it('pins the official tag boundary and native ARM64 Runtime route', () => {
    expect(buildWorkflow).toContain('runs-on: ubuntu-24.04-arm')
    expect(buildWorkflow).toContain('repository: deepseek-ai/deepseek-harness')
    expect(buildWorkflow).toContain('test "dsh-v$version" = "$DSH_REF"')
    expect(buildWorkflow).toContain('scripts/build-on-arm64.sh')
  })

  it('runs quality gates on carrier tests, shell scripts, and python tools', () => {
    expect(testWorkflow).toContain('bash -n scripts/*.sh build/*.sh office/dsh-office office/dsh-browser office/dsh-python')
    expect(testWorkflow).toContain('python3 -m py_compile office/office_tool.py office/browser_tool.py')
  })
})
