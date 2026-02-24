import http from 'http'
import client from 'prom-client'
import { logger } from '@libp2p/logger'

const log = logger('le-space:relay')

let metricsInstance: MetricsServer | null = null
let defaultMetricsInitialized = false

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

export class MetricsServer {
  server: http.Server | null
  startPromise: Promise<http.Server | null> | null

  constructor() {
    this.server = null
    this.startPromise = null

    if (!metricsInstance) {
      metricsInstance = this
    }
    return metricsInstance
  }

  async getMetrics() {
    return await client.register.metrics()
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
        } else {
          res.statusCode = 404
          res.end('Not found')
        }
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
