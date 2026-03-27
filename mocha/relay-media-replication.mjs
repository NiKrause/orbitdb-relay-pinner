import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { multiaddr } from '@multiformats/multiaddr'

import { runRelayMediaReplicationScenario } from './lib/relay-replication-harness.mjs'

describe('relay media replication', function () {
  this.timeout(180000)

  let tempRoot
  const localOrbitDbDir = join(process.cwd(), 'orbitdb')
  let relayRuntime
  let startRelay
  let relayAddr
  let metricsPort
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
    metricsPort = 21492 + Math.floor(Math.random() * 1000)
    process.env.METRICS_PORT = String(metricsPort)
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
    await runRelayMediaReplicationScenario({
      tempRoot,
      relayAddr,
      metricsPort,
      dbBaseName: 'alice-posts',
    })
  })
})
