import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'
import { KylinProcessTree } from '../build/kylin-process-tree.ts'

test('Linux quit reaps detached TERM-resistant workers without touching unrelated processes',
  { skip: process.platform !== 'linux' }, async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'dsh-process-tree-'))
    const ready = join(scratch, 'ready.json')
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    const parent = spawn(process.execPath, ['-e', `
      const {spawn}=require('node:child_process'),fs=require('node:fs');
      const worker=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'ignore'});
      worker.unref();setTimeout(()=>fs.writeFileSync(process.argv[1],JSON.stringify({worker:worker.pid})),500);
      setInterval(()=>{},1000);
    `, ready], { stdio: 'ignore' })
    let worker, tree
    try {
      tree = new KylinProcessTree(parent.pid)
      for (let i = 0; i < 60 && !existsSync(ready); i++) await delay(100)
      assert.ok(existsSync(ready), 'Worker fixture did not start')
      worker = JSON.parse(readFileSync(ready)).worker
      await delay(500)
      // Reparent the worker before cleanup; a process-group-only check misses it.
      parent.kill('SIGKILL')
      await new Promise(resolve => parent.once('close', resolve))
      process.kill(worker, 0)
      await tree.stop()
      let alive = false
      try {
        const stat = readFileSync(`/proc/${worker}/stat`, 'utf8')
        alive = !['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0])
      } catch (error) { if (error.code !== 'ENOENT') throw error }
      assert.equal(alive, false, 'Detached worker survived desktop cleanup')
      process.kill(unrelated.pid, 0)
      assert.equal(unrelated.exitCode, null)
    } finally {
      await tree?.stop()
      parent.kill('SIGKILL'); unrelated.kill('SIGKILL')
      if (worker) { try { process.kill(worker, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error } }
      rmSync(scratch, { recursive: true, force: true })
    }
  })
