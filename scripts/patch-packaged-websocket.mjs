import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = resolve(process.argv[2])
const before = 'if (list.length === 2) {\n      this._socket.cork();'
const after = 'if (list.length === 2 && list[1].length !== 0) {\n      this._socket.cork();'
const recordsFile = join(dirname(root), 'runtime-patches.json')
const diffFile = join(dirname(root), 'runtime-patches.diff')
const records = JSON.parse(readFileSync(recordsFile, 'utf8'))
let diff = readFileSync(diffFile, 'utf8')
let count = 0
for (const file of readdirSync(root, { recursive: true })) {
  if (!file.endsWith('node_modules/ws/lib/sender.js')) continue
  const path = join(root, file)
  const original = readFileSync(path, 'utf8')
  if (original.split(before).length !== 2 || original.includes(after)) {
    throw new Error(`Unsupported WebSocket sender runtime: ${file}`)
  }
  // Kylin V10 SP1 reports EFAULT/write for the empty Ping's [header, empty]
  // writev. Write the same complete frame header directly, without an empty
  // iovec. Payload bytes, masking, compression, callbacks and heartbeats stay
  // unchanged; this also covers empty Pong/Close/data frames from Node clients.
  const patched = original.replace(before, after)
  writeFileSync(path, patched)
  const sha = bytes => createHash('sha256').update(bytes).digest('hex')
  records.push({ path: file, beforeSha256: sha(original), afterSha256: sha(patched) })
  const lines = original.split('\n')
  const index = lines.findIndex(line => line.includes('if (list.length === 2) {'))
  diff += `--- a/${file}\n+++ b/${file}\n@@ -${index + 1},1 +${index + 1},1 @@\n-${lines[index]}\n+${lines[index].replace('list.length === 2', 'list.length === 2 && list[1].length !== 0')}\n`
  count++
}
if (!count) throw new Error('Missing packaged WebSocket sender runtime')
writeFileSync(recordsFile, JSON.stringify(records, null, 2) + '\n')
writeFileSync(diffFile, diff)
console.log(`WebSocket empty-frame compatibility: patched ${count} runtime module(s).`)
