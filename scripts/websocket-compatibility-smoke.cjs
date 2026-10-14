// Run with the actual materialized/final-ASAR ws and Electron's Node runtime.
const assert = require('node:assert/strict')
const {readFileSync} = require('node:fs')
const {join} = require('node:path')
const {Module} = require('node:module')
const {Writable} = require('node:stream')
const {createServer} = require('node:http')
const {once} = require('node:events')
const ws = require(process.argv[2])
const file = join(process.argv[2],'lib/sender.js')
const patched = readFileSync(file,'utf8')
const before = 'if (list.length === 2) {\n      this._socket.cork();'
const after = 'if (list.length === 2 && list[1].length !== 0) {\n      this._socket.cork();'
assert.equal(patched.split(after).length,2,'packaged ws compatibility patch missing')
const reference = new Module(file,module)
reference.filename = file
reference.paths = Module._nodeModulePaths(join(process.argv[2],'lib'))
reference._compile(patched.replace(after,before),file)
const OriginalSender = reference.exports
const fault = () => Object.assign(new Error('injected zero-length iovec failure'),{code:'EFAULT',syscall:'write'})

class Carrier extends Writable {
  constructor(rejectEmpty) {super();this.rejectEmpty=rejectEmpty;this.bytes=[]}
  _write(chunk,_encoding,callback) {this.bytes.push(chunk);callback()}
  _writev(chunks,callback) {
    if (this.rejectEmpty && chunks.some(({chunk})=>chunk.length===0)) return callback(fault())
    this.bytes.push(...chunks.map(({chunk})=>chunk));callback()
  }
}
async function sendFrame(Sender,payload,opcode,mask,rejectEmpty) {
  const carrier = new Carrier(rejectEmpty)
  carrier.on('error',()=>{})
  const sender = new Sender(carrier)
  const frames = Sender.frame(Buffer.isBuffer(payload) ? Buffer.from(payload) : payload,{fin:true,opcode,mask,rsv1:false,
    maskBuffer:Buffer.alloc(4),generateMask:buffer=>buffer.fill(0x11),readOnly:false})
  const error = await new Promise(resolve=>sender.sendFrame(frames,resolve))
  return {error,bytes:Buffer.concat(carrier.bytes)}
}
async function wireBytes() {
  const original = await sendFrame(OriginalSender,Buffer.alloc(0),9,false,true)
  assert.equal(original.error.code,'EFAULT','baseline must reproduce empty Ping writev failure')
  for (const opcode of [1,2,8,9,10]) {
    for (const mask of [false,true]) {
      for (const payload of [Buffer.alloc(0),Buffer.from('payload'),'', '中文']) {
        const baseline = await sendFrame(OriginalSender,payload,opcode,mask,false)
        const fixed = await sendFrame(ws.Sender,payload,opcode,mask,true)
        assert.ifError(fixed.error)
        assert.deepEqual(fixed.bytes,baseline.bytes,'WebSocket wire bytes changed')
      }
    }
  }
  console.log('WebSocket compatibility smoke passed: baseline EFAULT reproduced; 40 frames byte-identical')
}
async function connection(baseline) {
  const http = createServer()
  const server = new ws.WebSocketServer({noServer:true,perMessageDeflate:true})
  let accepted,emptyWrites=0,pings=0,pongs=0,tcpError,closeCode
  http.on('upgrade',(request,carrier,head)=> {
    const writev = carrier._writev
    carrier._writev = function(chunks,callback) {
      if (chunks.some(({chunk})=>chunk.length===0)) {emptyWrites++;return callback(fault())}
      return writev.call(this,chunks,callback)
    }
    // The real Host HTTP owner destroys its socket after a TCP write error.
    carrier.on('error',error=>{tcpError=error;carrier.destroy()})
    server.handleUpgrade(request,carrier,head,socket=> {
      accepted=socket
      if (baseline) socket._sender.sendFrame=OriginalSender.prototype.sendFrame
      socket.on('pong',()=>pongs++)
      socket.on('close',code=>{closeCode=code})
      server.emit('connection',socket,request)
    })
  })
  await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve))
  const client = new ws(`ws://127.0.0.1:${http.address().port}`,{perMessageDeflate:true})
  client.on('error',()=>{})
  try {
    await once(client,'open')
    const closed=once(accepted,'close')
    if (baseline) {
      pings++;accepted.ping()
      await closed
      assert.equal(emptyWrites,1)
      assert.equal(tcpError.code,'EFAULT')
      assert.equal(closeCode,1006);assert.equal(pings,1);assert.equal(pongs,0)
      console.log('WebSocket compatibility smoke passed: original first Ping -> EFAULT/write -> close(1006)')
    } else {
      for (let i=0;i<30;i++) {
        const pong=once(accepted,'pong')
        pings++;accepted.ping()
        assert.equal((await pong)[0].length,0)
      }
      // Exercise automatic Pong and empty text/binary data, with and without
      // compression, rather than testing only the heartbeat call itself.
      const clientPong=once(client,'pong')
      client.ping()
      assert.equal((await clientPong)[0].length,0)
      for (const compress of [false,true]) {
        for (const payload of ['',Buffer.alloc(0),'中文'.repeat(1000),Buffer.alloc(4096,0x42)]) {
          const message=once(client,'message')
          const sent=new Promise((resolve,reject)=>accepted.send(payload,{compress},error=>error ? reject(error) : resolve()))
          assert.deepEqual((await message)[0],Buffer.isBuffer(payload) ? payload : Buffer.from(payload))
          await sent
        }
      }
      accepted.close(1000)
      await closed
      assert.equal(emptyWrites,0)
      assert.equal(closeCode,1000)
      assert.equal(pings,30);assert.equal(pongs,30)
      assert.equal(tcpError,undefined)
      console.log('WebSocket compatibility smoke passed: 30 empty Ping/Pong cycles + data/compression + clean close under EFAULT injection')
    }
  } finally {
    client.terminate();accepted?.terminate()
    await new Promise(resolve=>server.close(resolve))
    await new Promise(resolve=>http.close(resolve))
  }
}
;(async()=>{await wireBytes();await connection(true);await connection(false)})()
  .catch(error=>{console.error(error);process.exitCode=1})
