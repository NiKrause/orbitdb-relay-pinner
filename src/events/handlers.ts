import { WebSocketsSecure } from '@multiformats/multiaddr-matcher'

import { log } from '../utils/logger.js'
import { loggingConfig } from '../config/logging.js'
import { isRelayRequireOrbitdbHeadsProtocolEnabled } from '../config/orbitdb-inbound-filter-env.js'
import { incRelayInboundOrbitdbHeadsReject } from '../services/metrics.js'

function remoteHasOrbitdbHeadsProtocol(protocols: unknown): boolean {
  if (!Array.isArray(protocols)) return false
  return protocols.some((p) => typeof p === 'string' && p.startsWith('/orbitdb/heads/'))
}

export function setupEventHandlers(libp2p: any) {
  const cleanupFunctions: Array<() => void> = []
  const certificateIntervals = new Set<ReturnType<typeof setInterval>>()
  let isShuttingDown = false

  const peerConnectHandler = async (event: any) => {
    const peer = event.detail
    if (loggingConfig.logLevels.peer) log('peer:connect', peer)
  }
  libp2p.addEventListener('peer:connect', peerConnectHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('peer:connect', peerConnectHandler))

  const peerIdentifyHandler = async (event: any) => {
    if (isShuttingDown) return
    const detail = event.detail
    const protocols = detail?.protocols ?? []
    const peerIdStr = detail?.peerId?.toString?.() ?? 'unknown'
    const direction = detail?.connection?.direction

    if (loggingConfig.logLevels.peer) {
      log('peer:protocols-after-identify', {
        peerId: peerIdStr,
        direction,
        protocols: Array.isArray(protocols) ? protocols : Array.from(protocols || []),
      })
    }

    if (!isRelayRequireOrbitdbHeadsProtocolEnabled()) return

    const connection = detail?.connection
    if (connection?.direction !== 'inbound') return
    if (remoteHasOrbitdbHeadsProtocol(protocols)) return

    try {
      incRelayInboundOrbitdbHeadsReject()
      if (loggingConfig.logLevels.peer) {
        log('peer:identify:rejected-missing-orbitdb-heads %s', peerIdStr)
      }
      await connection.close()
    } catch {
      // ignore close errors (peer may already be gone)
    }
  }
  libp2p.addEventListener('peer:identify', peerIdentifyHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('peer:identify', peerIdentifyHandler))

  const certificateHandler = () => {
    const interval = setInterval(() => {
      const mas = libp2p
        .getMultiaddrs()
        .filter((ma: any) => WebSocketsSecure.exactMatch(ma) && ma.toString().includes('/sni/'))
        .map((ma: any) => ma.toString())
      if (mas.length > 0) {
        clearInterval(interval)
        certificateIntervals.delete(interval)
      }
    }, 1000)
    certificateIntervals.add(interval)
  }
  libp2p.addEventListener('certificate:provision', certificateHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('certificate:provision', certificateHandler))

  const peerDisconnectHandler = async (event: any) => {
    libp2p.peerStore.delete(event.detail)
  }
  libp2p.addEventListener('peer:disconnect', peerDisconnectHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('peer:disconnect', peerDisconnectHandler))

  const connectionOpenHandler = async (event: any) => {
    const connection = event.detail
    if (loggingConfig.logLevels.connection) log('connection:open', connection.remoteAddr.toString())
  }
  libp2p.addEventListener('connection:open', connectionOpenHandler)
  cleanupFunctions.push(() => libp2p.removeEventListener('connection:open', connectionOpenHandler))

  return async () => {
    isShuttingDown = true
    cleanupFunctions.forEach((cleanup) => cleanup())

    for (const interval of certificateIntervals) {
      clearInterval(interval)
    }
    certificateIntervals.clear()
  }
}
