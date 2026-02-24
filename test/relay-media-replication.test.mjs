import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { createOrbitDB } from '@orbitdb/core'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { multiaddr } from '@multiformats/multiaddr'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import * as raw from 'multiformats/codecs/raw'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'

const waitFor = async (check, timeoutMs = 45000, intervalMs = 250) => {
  const start = Date.now()
  // Retry until timeout so integration test can tolerate network startup jitter.
  while (Date.now() - start <= timeoutMs) {
    try {
      const value = await check()
      if (value) return value
    } catch {
      // keep polling
    }
    await delay(intervalMs)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

const withTimeout = async (promise, timeoutMs) => {
  return await Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(`Operation timed out after ${timeoutMs}ms`)
    }),
  ])
}

const createClient = async (orbitdbDirectory) => {
  const libp2p = await createLibp2p({
    addresses: {
      listen: ['/ip4/127.0.0.1/tcp/0', '/ip4/127.0.0.1/tcp/0/ws'],
    },
    transports: [tcp(), webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      ping: ping(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
    },
  })

  const ipfs = await createHelia({ libp2p })
  const orbitdb = await createOrbitDB({ ipfs, directory: orbitdbDirectory })
  return { libp2p, ipfs, orbitdb }
}

const stopClient = async (client) => {
  try {
    await client.orbitdb.stop()
  } catch {}
  try {
    await client.ipfs.stop()
  } catch {}
  try {
    await client.libp2p.stop()
  } catch {}
}

describe('relay media replication', function () {
  this.timeout(180000)

  let tempRoot
  const localOrbitDbDir = join(process.cwd(), 'orbitdb')
  let relayRuntime
  let startRelay
  let relayAddr
  let alice
  let bob
  let aliceDbAddress
  const originalEnv = {}

  before(async () => {
    await rm(localOrbitDbDir, { recursive: true, force: true })

    tempRoot = await mkdtemp(join(tmpdir(), 'relay-media-test-'))
    const wsPort = 19492 + Math.floor(Math.random() * 1000)
    const tcpPort = wsPort - 1

    for (const key of [
      'RELAY_TCP_PORT',
      'RELAY_WS_PORT',
      'RELAY_WEBRTC_PORT',
      'RELAY_DISABLE_WEBRTC',
      'RELAY_DISABLE_IPV6',
      'RELAY_LISTEN_IPV4',
      'METRICS_PORT',
      'METRICS_DISABLED',
      'disableAutoTLS',
      'PUBSUB_TOPICS',
    ]) {
      originalEnv[key] = process.env[key]
    }

    process.env.RELAY_TCP_PORT = String(tcpPort)
    process.env.RELAY_WS_PORT = String(wsPort)
    process.env.RELAY_WEBRTC_PORT = '0'
    process.env.RELAY_DISABLE_WEBRTC = '1'
    process.env.RELAY_DISABLE_IPV6 = '1'
    process.env.RELAY_LISTEN_IPV4 = '127.0.0.1'
    process.env.METRICS_PORT = '0'
    process.env.disableAutoTLS = '1'
    process.env.PUBSUB_TOPICS = 'relay.media.test._peer-discovery._p2p._pubsub'

    ;({ startRelay } = await import('../dist/index.js'))
    relayRuntime = await startRelay({
      testMode: true,
      storageDir: join(tempRoot, 'relay'),
    })
    relayAddr = multiaddr(`/ip4/127.0.0.1/tcp/${wsPort}/ws`)
  })

  after(async () => {
    if (bob) await stopClient(bob)
    if (alice) await stopClient(alice)
    if (relayRuntime) await relayRuntime.stop()

    for (const [key, value] of Object.entries(originalEnv)) {
      if (typeof value === 'undefined') delete process.env[key]
      else process.env[key] = value
    }

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true })
    }

    await rm(localOrbitDbDir, { recursive: true, force: true })
  })

  it('lets bob read alice post and image CID from relay after alice is offline', async () => {
    alice = await createClient(join(tempRoot, 'alice-orbitdb'))
    await alice.libp2p.dial(relayAddr)

    const aliceDb = await alice.orbitdb.open('alice-posts', { type: 'events' })

    const imageBlocks = []
    for (let i = 1; i <= 1; i++) {
      const bytes = uint8ArrayFromString(`image-${i}-from-alice`)
      const hash = await sha256.digest(bytes)
      const imageCid = CID.createV1(raw.code, hash)

      await alice.ipfs.blockstore.put(imageCid, bytes)
      imageBlocks.push({ cid: imageCid, bytes })

      await aliceDb.add({
        postId: `post-${i}`,
        imageCid: imageCid.toString(),
        text: `Post ${i}`,
      })

      // Give the relay time to process each update event and pin incrementally.
      await delay(1200)
    }

    aliceDbAddress = aliceDb.address
    await delay(4000)

    await stopClient(alice)
    alice = null

    bob = await createClient(join(tempRoot, 'bob-orbitdb'))
    await bob.libp2p.dial(relayAddr)

    const bobDb = await bob.orbitdb.open(aliceDbAddress)

    const records = await waitFor(async () => {
      const all = await bobDb.all()
      return all.length >= 1 ? all : null
    })

    assert.equal(records.length, 1)
    const seenCids = records.map((record) => record?.value?.imageCid).filter(Boolean)
    assert.equal(seenCids.length, 1)

    for (const { cid, bytes } of imageBlocks) {
      const fetched = await waitFor(async () => {
        const block = await withTimeout(bob.ipfs.blockstore.get(cid), 1500)
        return block
      })
      assert.deepEqual(Buffer.from(fetched), Buffer.from(bytes))
    }
  })
})
