import assert from 'node:assert/strict'

import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function chunkToUint8Array(chunk) {
  if (chunk instanceof Uint8Array) return chunk
  if (chunk != null && typeof chunk === 'object' && typeof chunk.subarray === 'function') {
    return chunk.subarray()
  }
  throw new TypeError('Unexpected stream chunk type')
}

async function readLine(stream) {
  let buf = ''
  for await (const chunk of stream.source) {
    buf += textDecoder.decode(chunkToUint8Array(chunk), { stream: true })
    const idx = buf.indexOf('\n')
    if (idx !== -1) return buf.slice(0, idx).trim()
  }
  return buf.trim()
}

function encodeFrame(payload) {
  const frame = new Uint8Array(4 + payload.length)
  new DataView(frame.buffer).setUint32(0, payload.length, false)
  frame.set(payload, 4)
  return frame
}

async function readExactly(iterator, n) {
  const out = new Uint8Array(n)
  let offset = 0
  let carry = new Uint8Array(0)
  while (offset < n) {
    if (carry.length === 0) {
      const { value, done } = await iterator.next()
      if (done) throw new Error(`stream ended after ${offset} of ${n} bytes`)
      carry = chunkToUint8Array(value)
    }
    const use = Math.min(n - offset, carry.length)
    out.set(carry.subarray(0, use), offset)
    offset += use
    carry = carry.subarray(use)
  }
  return out
}

async function readFrame(stream) {
  const iterator = stream.source[Symbol.asyncIterator]()
  const lenBuf = await readExactly(iterator, 4)
  const len = new DataView(lenBuf.buffer, lenBuf.byteOffset, 4).getUint32(0, false)
  return await readExactly(iterator, len)
}

async function createNode(services = {}) {
  const node = await createLibp2p({
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0'],
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services,
  })
  return node
}

describe('connectivity debug protocols service', function () {
  this.timeout(60000)

  let exports

  before(async () => {
    exports = await import('../dist/index.js')
  })

  it('does not register echo or bulk by default', async () => {
    const server = await createNode({
      connectivityDebugProtocols: exports.connectivityDebugProtocolsService({}),
    })
    try {
      const protocols = server.getProtocols()
      assert.equal(protocols.includes(exports.CONNECTIVITY_ECHO_PROTOCOL), false)
      assert.equal(protocols.includes(exports.CONNECTIVITY_BULK_PROTOCOL), false)
    } finally {
      await server.stop()
    }
  })

  it('handles echo and registers bulk when explicitly enabled', async () => {
    const server = await createNode({
      connectivityDebugProtocols: exports.connectivityDebugProtocolsService({
        echo: { enabled: true },
        bulk: { enabled: true },
      }),
    })
    const client = await createNode()

    try {
      const protocols = server.getProtocols()
      assert.equal(protocols.includes(exports.CONNECTIVITY_ECHO_PROTOCOL), true)
      assert.equal(protocols.includes(exports.CONNECTIVITY_BULK_PROTOCOL), true)

      const addr = server.getMultiaddrs().find((value) => value.toString().includes('/ip4/127.0.0.1/tcp/'))
      assert.ok(addr, 'expected a local listen address')
      const echoStream = await client.dialProtocol(addr, exports.CONNECTIVITY_ECHO_PROTOCOL)
      try {
        await echoStream.sink(
          (async function* () {
            yield textEncoder.encode('hello-debug\n')
          })(),
        )
        const reply = await readLine(echoStream)
        assert.equal(reply, 'echo:hello-debug')
      } finally {
        await echoStream.close().catch(() => {})
      }
    } finally {
      await client.stop().catch(() => {})
      await server.stop().catch(() => {})
    }
  })
})
