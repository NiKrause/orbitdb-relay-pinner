/**
 * Runs the same Node (mocha) replication + relay pinning flow as `relay-media-replication.mjs`
 * for each **label** in the simple-todo Playwright matrix
 * (`e2e/simple-todo-webauthn-delegation.spec.js` → `runDelegatedFlowForModeCombination`).
 *
 * **Identity modes:** Worker vs hardware WebAuthn (Ed25519 / P-256) cannot be exercised in pure
 * Node without browser WebAuthn or software test identities from
 * `@le-space/orbitdb-identity-provider-webauthn-did`. Here we still use the default OrbitDB client
 * identity (same as the single relay-media test) while isolating each scenario with its own DB name
 * and Alice/Bob directories. That gives **stack** coverage (libp2p, relay HTTP sync, pinning, Bob
 * sync after Alice offline) **per matrix row**; crypto mode coverage remains in simple-todo E2E or
 * future Node fixtures.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { multiaddr } from '@multiformats/multiaddr'

import { runRelayMediaReplicationScenario } from './lib/relay-replication-harness.mjs'

/** Same scenario ids as simple-todo `simple-todo-webauthn-delegation.spec.js`. */
const MODE_MATRIX_ROWS = [
  'alice-worker-bob-hardware-ed25519',
  'alice-worker-bob-hardware-p256',
  'alice-hardware-ed25519-bob-hardware-p256',
  'alice-worker-ed25519-bob-worker-ed25519',
  'alice-hardware-ed25519-bob-hardware-ed25519',
  'alice-hardware-p256-bob-hardware-p256',
]

describe('relay replication (simple-todo mode matrix labels, Node stack)', function () {
  this.timeout(180000)

  let tempRoot
  const localOrbitDbDir = join(process.cwd(), 'orbitdb')
  let relayRuntime
  let metricsPort
  let relayAddr
  const originalEnv = {}

  before(async () => {
    await rm(localOrbitDbDir, { recursive: true, force: true })

    tempRoot = await mkdtemp(join(tmpdir(), 'relay-matrix-test-'))
    const wsPort = 20492 + Math.floor(Math.random() * 1000)
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
    metricsPort = 22492 + Math.floor(Math.random() * 1000)
    process.env.METRICS_PORT = String(metricsPort)
    process.env.disableAutoTLS = '1'
    process.env.PUBSUB_TOPICS = 'relay.matrix.test._peer-discovery._p2p._pubsub'

    const { startRelay } = await import('../dist/index.js')
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

  for (const scenarioId of MODE_MATRIX_ROWS) {
    it(`replicates: ${scenarioId}`, async () => {
      await runRelayMediaReplicationScenario({
        tempRoot,
        relayAddr,
        metricsPort,
        dbBaseName: `posts-${scenarioId}`,
      })
    })
  }
})
