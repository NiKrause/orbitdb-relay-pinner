import http from 'http'
import client from 'prom-client'
import { logger } from '@libp2p/logger'

const log = logger('le-space:relay')

let metricsInstance: MetricsServer | null = null

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
  constructor() {
    if (!metricsInstance) {
      if (!client.register.getSingleMetric('process_cpu_user_seconds_total')) {
        client.collectDefaultMetrics()
      }
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

    return listen(Number.isFinite(desiredPort) ? desiredPort : 9090)
  }

  trackSync(type: string, status = 'success') {
    syncCounter.labels(type, status).inc()
  }

  startSyncTimer(type: string) {
    return syncDurationHistogram.startTimer({ type })
  }
}

