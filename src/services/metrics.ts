import http from 'http'
import client from 'prom-client'
import { logger } from '@libp2p/logger'

const log = logger('le-space:relay')

let metricsInstance: MetricsServer | null = null
let defaultMetricsInitialized = false

type Libp2pLike = {
  peerId?: { toString: () => string }
  getMultiaddrs?: () => Array<{ toString: () => string }>
  getConnections?: () => unknown[]
}

type MetricsServerOptions = {
  getLibp2p?: () => Libp2pLike | null
}

const syncCounter = new client.Counter({
  name: 'orbitdb_sync_total',
  help: 'Total number of OrbitDB synchronization operations',
  labelNames: ['type', 'status'],
})

const syncDurationHistogram = new client.Histogram({
  name: 'orbitdb_sync_duration_seconds',
  help: 'Duration of OrbitDB synchronization operations',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
})

function isPublicAddress(addr: string): boolean {
  if (!addr) return false
  if (addr.includes('/ip4/127.')) return false
  if (addr.includes('/ip4/10.')) return false
  if (addr.includes('/ip4/192.168.')) return false
  const m = addr.match(/\/ip4\/172\.(\d+)\./)
  if (m) {
    const octet = Number(m[1])
    if (octet >= 16 && octet <= 31) return false
  }
  if (addr.includes('/ip6/::1')) return false
  if (addr.includes('/ip6/fc') || addr.includes('/ip6/fd')) return false
  return true
}

function prioritizeAddresses(addrs: string[]): string[] {
  return [...addrs].sort((a, b) => {
    const aPublic = isPublicAddress(a)
    const bPublic = isPublicAddress(b)
    if (aPublic !== bPublic) return aPublic ? -1 : 1
    return a.localeCompare(b)
  })
}

export class MetricsServer {
  server: http.Server | null
  startPromise: Promise<http.Server | null> | null
  options: MetricsServerOptions

  constructor(options: MetricsServerOptions = {}) {
    this.server = null
    this.startPromise = null
    this.options = options

    if (!metricsInstance) {
      metricsInstance = this
    }

    if (options.getLibp2p) {
      metricsInstance.options.getLibp2p = options.getLibp2p
    }

    return metricsInstance
  }

  async getMetrics() {
    return await client.register.metrics()
  }

  private getLibp2p(): Libp2pLike | null {
    try {
      return this.options.getLibp2p?.() || null
    } catch {
      return null
    }
  }

  start(port: number | string = process.env.METRICS_PORT || 9090) {
    if (process.env.METRICS_DISABLED === 'true' || process.env.METRICS_DISABLED === '1') {
      log('Metrics server disabled (METRICS_DISABLED)')
      return null
    }

    if (this.server) return Promise.resolve(this.server)
    if (this.startPromise) return this.startPromise

    if (!defaultMetricsInitialized && !client.register.getSingleMetric('process_cpu_user_seconds_total')) {
      client.collectDefaultMetrics()
      defaultMetricsInitialized = true
    }

    const desiredPort = typeof port === 'string' ? Number(port) : port

    const createServer = () =>
      http.createServer(async (req, res) => {
        if (req.url === '/metrics') {
          res.setHeader('Content-Type', client.register.contentType)
          res.end(await this.getMetrics())
          return
        }

        if (req.url === '/health') {
          const libp2p = this.getLibp2p()
          const connections = libp2p?.getConnections?.() || []
          const multiaddrs = (libp2p?.getMultiaddrs?.() || []).map((ma) => ma.toString())

          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              status: 'ok',
              peerId: libp2p?.peerId?.toString?.() || null,
              connections: { active: connections.length },
              multiaddrs: multiaddrs.length,
              timestamp: new Date().toISOString(),
            })
          )
          return
        }

        if (req.url === '/multiaddrs') {
          const libp2p = this.getLibp2p()
          const all = prioritizeAddresses((libp2p?.getMultiaddrs?.() || []).map((ma) => ma.toString()))
          const byTransport = {
            webrtc: all.filter((ma) => ma.includes('/webrtc')),
            tcp: all.filter((ma) => ma.includes('/tcp/') && !ma.includes('/ws')),
            websocket: all.filter((ma) => ma.includes('/ws')),
          }

          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({
              peerId: libp2p?.peerId?.toString?.() || null,
              all,
              byTransport,
              best: {
                webrtc: byTransport.webrtc[0] || null,
                websocket: byTransport.websocket[0] || null,
                tcp: byTransport.tcp[0] || null,
              },
              timestamp: new Date().toISOString(),
            })
          )
          return
        }

        res.statusCode = 404
        res.end('Not found')
      })

    const listen = (p: number): Promise<http.Server | null> =>
      new Promise((resolve) => {
        const server = createServer()
        server.on('error', (err: any) => {
          if (err?.code === 'EADDRINUSE' && p !== 0) {
            log(`Metrics port ${p} in use; retrying on an ephemeral port`)
            listen(0).then(resolve)
            return
          }
          log('Metrics server failed to start:', err?.message || err)
          resolve(null)
        })

        server.listen(p, () => resolve(server))
      })

    this.startPromise = listen(Number.isFinite(desiredPort) ? desiredPort : 9090).then((server) => {
      this.server = server
      this.startPromise = null
      return server
    })

    return this.startPromise
  }

  trackSync(type: string, status = 'success') {
    syncCounter.labels(type, status).inc()
  }

  startSyncTimer(type: string) {
    return syncDurationHistogram.startTimer({ type })
  }

  async stop() {
    if (this.startPromise) {
      await this.startPromise
    }

    if (!this.server) return

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve())
    })
    this.server = null
  }
}
