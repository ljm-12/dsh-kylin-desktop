import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const script = readFileSync(fileURLToPath(new URL('../scripts/build-on-arm64.sh', import.meta.url)), 'utf8')

describe('Native ARM64 build script', () => {
  it('rejects cross-architecture packaging and keeps the official Runtime pipeline intact', () => {
    expect(script).toContain('aarch64|arm64')
    expect(script).toContain('git -C "$SOURCE_DIR" describe --tags --exact-match')
    expect(script).toContain('quay.io/pypa/manylinux_2_28_aarch64')
    expect(script).toContain('--targets=node24-linux-arm64')
    expect(script).toContain('pnpm run smoke-runtime')
    expect(script).toContain('verify-linux-artifacts.sh "$VERSION"')
  })

  it('enforces required offline Office assets in early preflight and stages them unconditionally', () => {
    expect(script).toContain('test -d "$OFFICE_SRC/downloads"')
    expect(script).not.toContain('if [ -d "$OFFICE_SRC/downloads" ]; then')
  })
})
