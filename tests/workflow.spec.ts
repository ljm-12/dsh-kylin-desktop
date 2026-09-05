import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/build-kylin-arm64-desktop.yml', import.meta.url)),
  'utf8',
)

describe('Kylin native build workflow', () => {
  it('pins the official tag boundary and native ARM64 Runtime route', () => {
    expect(workflow).toContain('runs-on: ubuntu-24.04-arm')
    expect(workflow).toContain('repository: deepseek-ai/deepseek-harness')
    expect(workflow).toContain('test "dsh-v$version" = "$DSH_REF"')
    expect(workflow).toContain('scripts/build-on-arm64.sh')
  })
})
