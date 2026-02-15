import { createOrbitDB, useIdentityProvider } from '@orbitdb/core'
import OrbitDBIdentityProviderDID from '@orbitdb/identity-provider-did'
import * as KeyDIDResolver from 'key-did-resolver'

import { MetricsServer } from './metrics.js'
import { log, syncLog, logSyncStats } from '../utils/logger.js'
import { loggingConfig } from '../config/logging.js'

export class DatabaseService {
  metrics: MetricsServer
  identityDatabases: Map<string, any>
  databaseContexts: Map<string, any>
  updateTimers: Map<string, any>
  openDatabases: Map<string, any>
  eventHandlers: Map<string, any>
  orbitdb: any

  constructor() {
    this.metrics = new MetricsServer()
    this.identityDatabases = new Map()
    this.databaseContexts = new Map()
    this.updateTimers = new Map()
    this.openDatabases = new Map()
    this.eventHandlers = new Map()
  }

  async initialize(ipfs: any) {
    OrbitDBIdentityProviderDID.setDIDResolver(KeyDIDResolver.getResolver())
    useIdentityProvider(OrbitDBIdentityProviderDID as any)
    this.orbitdb = await createOrbitDB({ ipfs })
  }

  async syncAllOrbitDBRecords(dbAddress: string) {
    syncLog('Starting sync for database:', dbAddress)
    const endTimer = this.metrics.startSyncTimer('all_databases')

    try {
      let db: any
      if (this.openDatabases.has(dbAddress)) {
        db = this.openDatabases.get(dbAddress)
      } else {
        db = await this.orbitdb.open(dbAddress)
        this.openDatabases.set(dbAddress, db)
      }

      const previousCounts = this.identityDatabases.get(dbAddress) || { posts: 0, comments: 0, media: 0 }
      const records = await db.all()

      if (records.length > 0) {
        syncLog(`Sample record from ${db.name}:`, JSON.stringify(records[0], null, 2))
      }

      let recordCounts = { posts: 0, comments: 0, media: 0 }
      let dbType = 'unknown'

      if (db.name.includes('posts') || db.name.includes('post')) {
        recordCounts.posts = records.length
        dbType = 'posts'
      } else if (db.name.includes('comments') || db.name.includes('comment')) {
        recordCounts.comments = records.length
        dbType = 'comments'
      } else if (db.name.includes('media')) {
        recordCounts.media = records.length
        dbType = 'media'
      } else if (db.name.includes('settings') || db.name.includes('config')) {
        dbType = 'settings'
      }

      const peerId = db?.identity?.id
      logSyncStats(dbType, dbAddress, peerId, recordCounts, previousCounts)
      this.identityDatabases.set(dbAddress, recordCounts)

      this.metrics.trackSync('documents', 'success')
      endTimer()
    } catch (err: any) {
      this.metrics.trackSync('documents', 'failure')
      endTimer()
      if (loggingConfig.logLevels.database) {
        // eslint-disable-next-line no-console
        console.error('Failed to sync database:', err)
      }
    }
  }
}

