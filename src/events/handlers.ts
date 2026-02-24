import { identify } from '@libp2p/identify'
import PQueue from 'p-queue'
import { WebSocketsSecure } from '@multiformats/multiaddr-matcher'
import { log, syncLog } from '../utils/logger.js'
import { loggingConfig } from '../config/logging.js'

export function setupEventHandlers(libp2p: any, databaseService: any) {
  const cleanupFunctions: Array<() => void> = []

  const peerConnectHandler = async (event: any) => {
    const peer = event.detail
    try {
      if (loggingConfig.logLevels.peer) log('peer:connect', peer)
      await identify(peer)
    } catch (err: any) {
      if (err?.code !== 'ERR_UNSUPPORTED_PROTOCOL' && loggingConfig.logLevels.peer) {
        // eslint-disable-next-line no-console
        console.error('Failed to identify peer:', err)
      }
    }
  }
  libp2p.addEventListener('peer:connect', peerConnectHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('peer:connect', peerConnectHandler))

  const certificateHandler = () => {
    const interval = setInterval(() => {
      const mas = libp2p
        .getMultiaddrs()
        .filter((ma: any) => WebSocketsSecure.exactMatch(ma) && ma.toString().includes('/sni/'))
        .map((ma: any) => ma.toString())
      if (mas.length > 0) clearInterval(interval)
    }, 1000)
  }
  libp2p.addEventListener('certificate:provision', certificateHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('certificate:provision', certificateHandler))

  const peerDisconnectHandler = async (event: any) => {
    libp2p.peerStore.delete(event.detail)
  }
  libp2p.addEventListener('peer:disconnect', peerDisconnectHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('peer:disconnect', peerDisconnectHandler))

  const syncQueue = new PQueue({ concurrency: 2 })

  const pubsubMessageHandler = (event: any) => {
    const msg = event.detail
    syncLog('Received pubsub message:', msg.topic)
    if (msg.topic && msg.topic.startsWith('/orbitdb/')) {
      syncQueue.add(() => databaseService.syncAllOrbitDBRecords(msg.topic))
    }
  }
  libp2p.services.pubsub.addEventListener('message', pubsubMessageHandler)
  cleanupFunctions.push(() => libp2p.services.pubsub.removeEventListener('message', pubsubMessageHandler))

  const connectionOpenHandler = async (event: any) => {
    const connection = event.detail
    if (loggingConfig.logLevels.connection) log('connection:open', connection.remoteAddr.toString())
  }
  libp2p.addEventListener('connection:open', connectionOpenHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('connection:open', connectionOpenHandler))

  const pubsub = libp2p.services.pubsub
  pubsub.addEventListener('subscription-change', (event: any) => {
    if (event.detail?.subscriptions) {
      for (const subscription of event.detail.subscriptions) {
        if (subscription.topic?.startsWith('/orbitdb/')) {
          syncQueue.add(() => databaseService.syncAllOrbitDBRecords(subscription.topic))
        }
      }
    }
  })

  return () => cleanupFunctions.forEach((cleanup) => cleanup())
}
