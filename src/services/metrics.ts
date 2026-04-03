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

/** Result of POST `/pinning/sync` (also embedded in JSON response with `dbAddress`). */
export type PinningSyncResult = {
  ok: boolean
  error?: string
  /** Relay observed at least one OrbitDB `update` while syncing this address. */
  receivedUpdate?: boolean
  /** True when no live `update` arrived and media CIDs were taken from `db.all()` instead. */
  fallbackScanUsed?: boolean
  /** Media CIDs extracted from updates and/or `db.all()` fallback (same field rules as update-driven pinning). */
  extractedMediaCids?: string[]
  /** True when this request waited on another in-flight sync for the same address. */
  coalesced?: boolean
}

/** Result of {@link PinningHttpHandlers.streamPinnedCid} for GET `/ipfs/...`. */
export type StreamPinnedCidResult =
  | { ok: true; contentType?: string; chunks: AsyncIterable<Uint8Array> }
  | { ok: false; status: number; error: string }

export type PinningHttpHandlers = {
  getStats: () => Record<string, unknown>
  getDatabases: () => { databases: Array<Record<string, unknown>>; total: number }
  syncDatabase: (dbAddress: string) => Promise<PinningSyncResult>
  /**
   * Stream bytes for a CID only if it is pinned in Helia and only from local storage
   * (`offline` / no network fetch). Optional `pathWithin` is a UnixFS path inside a directory CID.
   */
  streamPinnedCid?: (cidStr: string, pathWithin?: string) => Promise<StreamPinnedCidResult>
}

type MetricsServerOptions = {
  getLibp2p?: () => Libp2pLike | null
  pinning?: PinningHttpHandlers
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
    if (options.pinning) {
      metricsInstance.options.pinning = options.pinning
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

    const readJsonBody = (req: http.IncomingMessage): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        req.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          if (!raw.trim()) {
            resolve({})
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch (e) {
            reject(e)
          }
        })
        req.on('error', reject)
      })

    const pathnameOnly = (url: string | undefined) => (url || '/').split('?')[0] || '/'

    const createServer = () =>
      http.createServer(async (req, res) => {
        const pathname = pathnameOnly(req.url)
        const pinning = this.options.pinning

        if (pinning && pathname === '/pinning/stats' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(pinning.getStats()))
          return
        }

        if (pinning && pathname === '/pinning/databases' && req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(pinning.getDatabases()))
          return
        }

        if (pinning && pathname === '/pinning/sync' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json')
          try {
            const body = (await readJsonBody(req)) as { dbAddress?: string }
            const dbAddress = typeof body?.dbAddress === 'string' ? body.dbAddress.trim() : ''
            if (!dbAddress) {
              res.statusCode = 400
              res.end(JSON.stringify({ ok: false, error: 'Missing or invalid dbAddress' }))
              return
            }
            const result = await pinning.syncDatabase(dbAddress)
            res.statusCode = result.ok ? 200 : 500
            if (result.ok) {
              res.end(
                JSON.stringify({
                  ok: true,
                  dbAddress,
                  receivedUpdate: result.receivedUpdate,
                  fallbackScanUsed: result.fallbackScanUsed,
                  extractedMediaCids: result.extractedMediaCids,
                  ...(result.coalesced ? { coalesced: true } : {}),
                })
              )
            } else {
              res.end(JSON.stringify({ ok: false, error: result.error || 'sync failed' }))
            }
          } catch (e: any) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }))
          }
          return
        }

        if (pinning?.streamPinnedCid && req.method === 'GET' && pathname.startsWith('/ipfs/')) {
          const tail = pathname.slice('/ipfs/'.length)
          let parts: string[]
          try {
            parts = tail.split('/').filter((p) => p.length > 0).map((p) => decodeURIComponent(p))
          } catch {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid path encoding' }))
            return
          }
          if (parts.length === 0) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Missing CID' }))
            return
          }
          const cidStr = parts[0]
          const pathWithin = parts.length > 1 ? parts.slice(1).join('/') : undefined

          const out = await pinning.streamPinnedCid(cidStr, pathWithin)
          if (!out.ok) {
            res.statusCode = out.status
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: out.error }))
            return
          }
          res.statusCode = 200
          if (out.contentType) {
            res.setHeader('Content-Type', out.contentType)
          }
          res.setHeader('Cache-Control', 'private, no-store')
          try {
            for await (const chunk of out.chunks) {
              if (!res.write(chunk)) {
                await new Promise<void>((resolve) => res.once('drain', resolve))
              }
            }
            res.end()
          } catch (e: any) {
            if (!res.writableEnded) {
              try {
                res.destroy(e)
              } catch {
                // ignore
              }
            }
          }
          return
        }

        if (pathname === '/metrics') {
          res.setHeader('Content-Type', client.register.contentType)
          res.end(await this.getMetrics())
          return
        }

        if (pathname === '/health') {
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

        if (pathname === '/multiaddrs') {
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
