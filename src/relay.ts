import { createLibp2p } from 'libp2p'
import { createHelia } from 'helia'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys'
import { join } from 'node:path'

import { createLibp2pConfig } from './config/libp2p.js'
import { initializeStorage } from './services/storage.js'
import { DatabaseService } from './services/database.js'
import { MetricsServer } from './services/metrics.js'
import { setupEventHandlers } from './events/handlers.js'

export type RelayOptions = {
  testMode?: boolean
  storageDir?: string
}

export type RelayRuntime = {
  stop: () => Promise<void>
}

export async function startRelay(opts: RelayOptions = {}): Promise<RelayRuntime> {
  const isTestMode = Boolean(opts.testMode)
  const storageDir =
    opts.storageDir || process.env.DATASTORE_PATH || process.env.RELAY_DATASTORE_PATH || './orbitdb/pinning-service'

  const storage = await initializeStorage(storageDir)
  const { blockstore, datastore } = storage

  let privateKey = storage.privateKey
  if (isTestMode) {
    const hex = process.env.TEST_PRIVATE_KEY || process.env.RELAY_PRIV_KEY
    if (hex) {
      privateKey = privateKeyFromProtobuf(uint8ArrayFromString(hex, 'hex'))
    }
  }

  const libp2p = await createLibp2p(createLibp2pConfig(privateKey, datastore))
  const ipfs = await createHelia({ libp2p, datastore, blockstore })

  const databaseService = new DatabaseService()
  await databaseService.initialize(ipfs as any, join(storageDir, 'orbitdb'))

  const cleanupEventHandlers = await setupEventHandlers(libp2p as any, databaseService as any)

  const metricsServer = new MetricsServer()
  await metricsServer.start()

  // Important: Playwright setup waits for this marker.
  // eslint-disable-next-line no-console
  console.log(`Relay PeerId: ${libp2p.peerId.toString()}`)
  // eslint-disable-next-line no-console
  console.log('p2p addr: ', libp2p.getMultiaddrs().map((ma) => ma.toString()))

  return {
    stop: async () => {
      databaseService.beginShutdown()
      try {
        await cleanupEventHandlers?.()
      } catch {
        // ignore
      }
      try {
        await databaseService.stop()
      } catch {
        // ignore
      }
      try {
        await metricsServer.stop()
      } catch {
        // ignore
      }
      try {
        // best effort; helia/libp2p will close underlying stores as well
        // @ts-expect-error helia internal store wrappers
        await ipfs.blockstore?.child?.child?.child?.close?.()
      } catch {
        // ignore
      }
      try {
        await ipfs.stop()
      } catch {
        // ignore
      }
      try {
        await datastore.close()
      } catch {
        // ignore
      }
      try {
        await blockstore.close()
      } catch {
        // ignore
      }
      try {
        await libp2p.stop()
      } catch {
        // ignore
      }
    },
  }
}
