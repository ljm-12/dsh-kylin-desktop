import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { patchLinuxTray } from './linux-tray-adapter.mjs'
import { linuxWindowReplacements, patchLinuxWindow } from './linux-window-adapter.mjs'

export const officialCommit = '687f282e8625c6b8d11ff58211a90524be2e4317'
export const allowedFiles = new Set([
  'apps/desktop/scripts/desktop-build-paths.mjs',
  'apps/desktop/scripts/desktop-build-paths.d.mts',
  'apps/desktop/scripts/prepare-runtime.ts',
  'apps/desktop/scripts/prepare-cli.ts',
  'apps/desktop/scripts/prepare-dsh.ts',
  'apps/desktop/scripts/development-project.ts',
  'apps/desktop/scripts/retain-desktop-ci.ts',
  'apps/desktop/scripts/electron-builder-config.mjs',
  'apps/desktop/cli/dsh',
  'apps/desktop/src/main.ts',
  'apps/desktop/src/preload-windows.ts',
  'apps/desktop/src/preload-platform.ts',
])
export function assertAllowedChanges(files) {
  const unsupported = files.filter(file => !allowedFiles.has(file))
  assert.equal(unsupported.length, 0, `Official runtime/UI outside the Linux shell adapters must remain unchanged: ${unsupported.join(', ')}`)
}
export function verifyOfficialSource(source) {
  const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), officialCommit, 'official source must use the pinned 0.2.1-rc.2 commit')
  const files = git(['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean)
  assertAllowedChanges(files)
  for (const file of linuxWindowReplacements.keys()) {
    if (!files.includes(file)) continue
    const original = execFileSync('git', ['-C', source, 'show', `HEAD:${file}`], { encoding: 'utf8' })
    const expected = patchLinuxWindow(file, file.endsWith('/main.ts') ? patchLinuxTray(original) : original)
    assert.equal(readFileSync(resolve(source, file), 'utf8'), expected,
      `Only the exact Linux shell adapters are permitted: ${file}`)
  }
  const runtime = 'apps/desktop/scripts/prepare-runtime.ts'
  if (files.includes(runtime)) {
    const prepared = readFileSync(resolve(source, runtime), 'utf8')
    assert.match(prepared, /const \{ version \} = require\('electron\/package\.json'\)/)
    assert.doesNotMatch(prepared, /officialElectronVersion/, 'use the official Electron dependency without a Linux override')
  }
  // Also reject added non-ignored runtime/source files.
  const additions = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
  assert.ok(additions.every(file => file === 'apps/desktop/src/kylin-process-tree.ts'), 'unexpected files in official checkout')
  if (files.includes('apps/desktop/src/main.ts')) {
    assert.deepEqual(readFileSync(resolve(source, 'apps/desktop/src/kylin-process-tree.ts')),
      readFileSync(new URL('../build/kylin-process-tree.ts', import.meta.url)), 'Linux process cleanup must match the packaging adapter')
  }
  console.log(`Official source verified: ${files.length} platform files; Linux shell changes checked exactly`)
  return [...files, ...additions]
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  verifyOfficialSource(resolve(process.argv[2]))
}
