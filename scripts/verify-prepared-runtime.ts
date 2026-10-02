import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const source = process.env.DSH_SOURCE_DIR
if (!source) throw new Error('DSH_SOURCE_DIR is required')
const desktop = join(source, 'apps/desktop')
const target = join(desktop, '.desktop-build/targets/linux-arm64')
const root = join(target, 'dsh')
const load = (path: string) => import(pathToFileURL(join(desktop, path)).href)
const { readDesktopRuntime, writeDesktopRuntime, verifyDesktopRuntime } = await load('src/runtime-tree.ts')
const { smokePreparedRuntime } = await load('scripts/smoke-prepared-runtime.ts')
const previous = readDesktopRuntime(root)
const packaged = process.argv[2]
if (packaged) {
  // Upstream verifies ASAR integrity and runs actual packaged Host/Office payloads.
  await smokePreparedRuntime(join(packaged, 'resources/app.asar/dsh'),
    join(packaged, 'deepseek-harness-kylin.bin'), join(packaged, 'resources/runtime'), previous)
} else {
  writeDesktopRuntime(root, previous.release, previous.sharedPackages.map((entry: { name: string }) => entry.name),
    { platform: 'linux', arch: 'arm64' })
  const descriptor = await verifyDesktopRuntime(root, previous.release.version, { platform: 'linux', arch: 'arm64' })
  await smokePreparedRuntime(root, join(target, 'electron/electron'), join(target, 'runtime'), descriptor)
}
