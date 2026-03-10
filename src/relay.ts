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
import { loggingConfig } from './config/logging.js'
import { headsStreamLog, log } from './utils/logger.js'

export type RelayOptions = {
  testMode?: boolean
  storageDir?: string
}

export type RelayRuntime = {
  stop: () => Promise<void>
}

function attachOrbitdbHeadsStreamLogging(libp2p: any) {
  if (!libp2p || libp2p.__orbitdbHeadsLoggingAttached) return

  const originalDialProtocol = libp2p.dialProtocol?.bind(libp2p)
  const originalHandle = libp2p.handle?.bind(libp2p)

  if (typeof originalDialProtocol === 'function') {
    libp2p.dialProtocol = async (peer: any, protocol: string, options: any) => {
      const isHeadsProtocol = typeof protocol === 'string' && protocol.startsWith('/orbitdb/heads/')
      const peerId = peer?.toString?.() || peer?.id?.toString?.() || 'unknown'

      if (isHeadsProtocol) {
        headsStreamLog('dial:start %s %s', peerId, protocol)
      }

      try {
        const stream = await originalDialProtocol(peer, protocol, options)
        if (isHeadsProtocol) {
          headsStreamLog('dial:connected %s %s', peerId, protocol)
        }
        return stream
      } catch (error: any) {
        if (isHeadsProtocol) {
          headsStreamLog('dial:error %s %s %s', peerId, protocol, error?.message || String(error))
        }
        throw error
      }
    }
  }

  if (typeof originalHandle === 'function') {
    libp2p.handle = async (protocol: string, handler: any, options: any) => {
      const isHeadsProtocol = typeof protocol === 'string' && protocol.startsWith('/orbitdb/heads/')
      if (!isHeadsProtocol) {
        return await originalHandle(protocol, handler, options)
      }

      headsStreamLog('handle:registered %s', protocol)
      const wrappedHandler = async (context: any) => {
        headsStreamLog(
          'handle:received %s %s',
          protocol,
          context?.connection?.remotePeer?.toString?.() || 'unknown'
        )
        return await handler(context)
      }

      return await originalHandle(protocol, wrappedHandler, options)
    }
  }

  libp2p.__orbitdbHeadsLoggingAttached = true
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
  attachOrbitdbHeadsStreamLogging(libp2p as any)
  const ipfs = await createHelia({ libp2p, datastore, blockstore })

  const databaseService = new DatabaseService()
  await databaseService.initialize(ipfs as any, join(storageDir, 'orbitdb'))

  const cleanupEventHandlers = await setupEventHandlers(libp2p as any, databaseService as any)

  const metricsServer = new MetricsServer({ getLibp2p: () => libp2p as any })
  await metricsServer.start()

  if (loggingConfig.enableGeneralLogs) {
    log('Relay PeerId: %s', libp2p.peerId.toString())
    log('p2p addr: %o', libp2p.getMultiaddrs().map((ma) => ma.toString()))
  }

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
