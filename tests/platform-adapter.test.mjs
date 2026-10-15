import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test from 'node:test'
import { patchOfficialDesktop } from '../scripts/patch-official-desktop.mjs'

test('Linux extension matches pinned official source and is idempotent',
  { skip: !process.env.DSH_TEST_SOURCE }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-official-adapter-test-'))
    try {
      const files = [
        'apps/desktop/scripts/desktop-build-paths.mjs',
        'apps/desktop/scripts/desktop-build-paths.d.mts',
        'apps/desktop/scripts/prepare-runtime.ts',
        'apps/desktop/scripts/prepare-cli.ts',
        'apps/desktop/scripts/prepare-dsh.ts',
        'apps/desktop/scripts/development-project.ts',
        'apps/desktop/scripts/electron-builder-config.mjs',
        'apps/desktop/cli/dsh',
        'apps/desktop/src/main.ts',
        'apps/desktop/src/preload-windows.ts',
        'apps/desktop/src/preload-platform.ts',
      ]
      for (const file of files) {
        const original = execFileSync('git', ['-C', process.env.DSH_TEST_SOURCE, 'show', `HEAD:${file}`])
        mkdirSync(join(root, file, '..'), { recursive: true })
        writeFileSync(join(root, file), original)
      }
      patchOfficialDesktop(root)
      const once = files.map(file => readFileSync(join(root, file), 'utf8'))
      patchOfficialDesktop(root)
      assert.deepEqual(files.map(file => readFileSync(join(root, file), 'utf8')), once)
      const { resolveDesktopBuildTarget, desktopTargetPlatform } = await import(join(root, files[0]))
      assert.equal(resolveDesktopBuildTarget({}, 'linux', 'arm64'), 'linux-arm64')
      assert.deepEqual(desktopTargetPlatform('linux-arm64'), { platform: 'linux', arch: 'arm64' })
      assert.throws(() => resolveDesktopBuildTarget({}, 'linux', 'x64'), /unsupported/)
      assert.equal(resolveDesktopBuildTarget({}, 'darwin', 'x64'), 'mac-x64')
      writeFileSync(join(root, files[0]), 'unsupported upstream rewrite')
      assert.throws(() => patchOfficialDesktop(root), /Unsupported official source/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

test('Kylin launcher preserves display/GPU compatibility, trust and caller arguments', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-launcher-test-'))
  try {
    mkdirSync(join(root, 'resources/config'), { recursive: true })
    const ca = join(realpathSync(root), 'resources/config/proxy-root-ca.crt')
    writeFileSync(ca, readFileSync(new URL('../config/proxy-root-ca.crt', import.meta.url)))
    const binary = join(root, 'deepseek-harness-kylin.bin')
    writeFileSync(binary, '#!/bin/bash\nprintf "%s\\n" "$NODE_EXTRA_CA_CERTS" "intranet=$DSH_INTRANET_MODE" "proxy=$NO_PROXY" "gdk=$GDK_BACKEND" "$@"\n', { mode: 0o755 })
    const launcher = join(root, 'deepseek-harness-kylin')
    writeFileSync(launcher, readFileSync(new URL('../build/kylin-launcher.sh', import.meta.url)), { mode: 0o755 })
    const env = { ...process.env, DISPLAY: ':99', NODE_EXTRA_CA_CERTS: '', DSH_INTRANET_MODE: '', NO_PROXY: 'existing.local', GDK_BACKEND: '', DSH_ENABLE_GPU: '', DSH_KYLIN_NO_SANDBOX: '' }
    const run = env => execFileSync('bash', [launcher, 'a b'], { env, encoding: 'utf8' })
    const result = run(env)
    assert.ok(result.startsWith(ca + '\n'))
    assert.equal(result, ca + '\nintranet=\nproxy=existing.local\ngdk=x11\n--disable-gpu\n--disable-accelerated-video-decode\n--ozone-platform=x11\na b\n')
    assert.doesNotMatch(result, /--no-sandbox/)
    assert.match(run({ ...env, DSH_KYLIN_NO_SANDBOX: '1' }), /--no-sandbox\n/)
    assert.doesNotMatch(run({ ...env, DISPLAY: '', DSH_ENABLE_GPU: '1' }), /--ozone-platform|--disable-gpu|--disable-accelerated-video-decode/)
    assert.match(run({ ...env, GDK_BACKEND: 'existing-backend' }), /gdk=existing-backend\n/)
    assert.match(run({ ...env, DSH_INTRANET_MODE: '0' }), /intranet=0\n/)
    const other = join(root, 'custom.pem')
    writeFileSync(other, readFileSync(ca))
    assert.ok(run({ ...env, NODE_EXTRA_CA_CERTS: other }).startsWith(other + '\n'))
    assert.throws(() => run({ ...env, NODE_EXTRA_CA_CERTS: join(root, 'missing.pem') }))
    writeFileSync(other, '-----BEGIN PRIVATE KEY-----')
    assert.throws(() => run({ ...env, NODE_EXTRA_CA_CERTS: other }))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
