import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(process.argv[2])
const before = 'lstatSync(join(directory, name), { throwIfNoEntry: false }) !== void 0'
const after = 'lstatSync(join(directory, name), { throwIfNoEntry: false }) != null'
const records = []
let diff = ''
for (const file of readdirSync(root, { recursive: true })) {
  if (!file.endsWith('node_modules/@deepseek-ai/libreoffice-kit/lib/index.js')) continue
  const path = join(root, file)
  const original = readFileSync(path, 'utf8')
  if (!original.includes(before)) throw new Error(`Unsupported Office runtime: ${file}`)
  // Electron 44 ASAR returns null for a missing entry; Node returns undefined.
  // Treat both as absent so the official Linux WASM fallback remains usable.
  const patched = original.replace(before, after)
  writeFileSync(path, patched)
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  records.push({ path: file, beforeSha256: sha(original), afterSha256: sha(patched) })
  const lines = original.split('\n')
  const index = lines.findIndex(line => line.includes(before))
  diff += `--- a/${file}\n+++ b/${file}\n@@ -${index + 1},1 +${index + 1},1 @@\n-${lines[index]}\n+${lines[index].replace(before, after)}\n`
}
if (!records.length) throw new Error('Missing official LibreOfficeKit runtime')
writeFileSync(join(dirname(root), 'runtime-patches.json'), JSON.stringify(records, null, 2) + '\n')
writeFileSync(join(dirname(root), 'runtime-patches.diff'), diff)
console.log(`Office ASAR compatibility: patched ${records.length} official runtime module(s).`)
