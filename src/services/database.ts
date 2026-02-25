import { createOrbitDB, useAccessController, useIdentityProvider } from '@orbitdb/core'
import OrbitDBIdentityProviderDID from '@orbitdb/identity-provider-did'
import * as KeyDIDResolver from 'key-did-resolver'
import { CID } from 'multiformats/cid'
import { setTimeout as delay } from 'node:timers/promises'
import PQueue from 'p-queue'

import { MetricsServer } from './metrics.js'
import { log, syncLog, logSyncStats } from '../utils/logger.js'
import { loggingConfig } from '../config/logging.js'
import DelegatedTodoAccessController from '../access/delegated-todo-access-controller.js'

export class DatabaseService {
  metrics: MetricsServer
  identityDatabases: Map<string, any>
  databaseContexts: Map<string, any>
  updateTimers: Map<string, any>
  eventHandlers: Map<string, any>
  pinQueue: PQueue
  queuedImageCids: Set<string>
  pinnedImageCids: Set<string>
  isShuttingDown: boolean
  orbitdb: any
  ipfs: any

  constructor() {
    this.metrics = new MetricsServer()
    this.identityDatabases = new Map()
    this.databaseContexts = new Map()
    this.updateTimers = new Map()
    this.eventHandlers = new Map()
    this.pinQueue = new PQueue({ concurrency: 4 })
    this.queuedImageCids = new Set()
    this.pinnedImageCids = new Set()
    this.isShuttingDown = false
  }

  async initialize(ipfs: any, directory?: string) {
    OrbitDBIdentityProviderDID.setDIDResolver(KeyDIDResolver.getResolver())
    useIdentityProvider(OrbitDBIdentityProviderDID as any)
    useAccessController(DelegatedTodoAccessController as any)
    this.ipfs = ipfs
    this.orbitdb = await createOrbitDB({ ipfs, ...(directory ? { directory } : {}) })
  }

  private extractImageCidsFromPayload(payload: any): string[] {
    const result = new Set<string>()

    const imageCid = payload?.imageCid ?? payload?.imageCID ?? payload?.image?.cid
    const profilePictureCid =
      payload?.profilePicture ??
      payload?.profilePictureCid ??
      payload?.profilePictureCID ??
      ((payload?._id === 'profilePicture' || payload?._id === 'profilePictureCid' || payload?._id === 'profilePictureCID')
        ? payload?.value
        : undefined)
    const mediaIds = Array.isArray(payload?.mediaIds) ? payload.mediaIds : []
    const mediaId = payload?.mediaId

    for (const candidate of [imageCid, profilePictureCid, mediaId, ...mediaIds]) {
      if (typeof candidate === 'string' && candidate.length > 0) result.add(candidate)
    }

    return Array.from(result)
  }

  private extractImageCids(records: any[]): string[] {
    const result = new Set<string>()

    for (const record of records) {
      const payload = record?.value ?? record
      for (const candidate of this.extractImageCidsFromPayload(payload)) result.add(candidate)
    }

    return Array.from(result)
  }

  private async pinImageCid(imageCid: string) {
    const cid = CID.parse(imageCid)
    for await (const _ of this.ipfs.pins.add(cid)) {
      // consume the async generator to completion
    }
    syncLog('Pinned image CID:', imageCid)
  }

  private enqueueImageCidsForPinning(imageCids: string[]) {
    if (!this.ipfs?.pins || imageCids.length === 0 || this.isShuttingDown) return

    for (const imageCid of imageCids) {
      if (this.pinnedImageCids.has(imageCid) || this.queuedImageCids.has(imageCid)) continue

      this.queuedImageCids.add(imageCid)
      this.pinQueue
        .add(async () => {
          try {
            await this.pinImageCid(imageCid)
            this.pinnedImageCids.add(imageCid)
          } catch (err: any) {
            if (loggingConfig.logLevels.database) {
              // eslint-disable-next-line no-console
              console.error(`Failed to pin image CID ${imageCid}:`, err?.message || err)
            }
          } finally {
            this.queuedImageCids.delete(imageCid)
          }
        })
        .catch(() => {
          // handled in task body
        })
    }
  }

  private async waitForUpdateEvent(db: any, timeoutMs = 5000): Promise<{ didReceiveUpdate: boolean; updates: any[] }> {
    if (!db?.events?.on || !db?.events?.off) return { didReceiveUpdate: false, updates: [] }

    let didUpdate = false
    const updates: any[] = []
    let lastUpdateAt = 0
    const onUpdate = (entry: any) => {
      didUpdate = true
      lastUpdateAt = Date.now()
      if (entry) updates.push(entry)
    }

    db.events.on('update', onUpdate)
    try {
      const startedAt = Date.now()
      while (!didUpdate && !this.isShuttingDown && Date.now() - startedAt < timeoutMs) {
        await delay(100)
      }

      // After first update, collect closely-following updates in the same sync burst.
      while (
        didUpdate &&
        !this.isShuttingDown &&
        Date.now() - startedAt < timeoutMs &&
        Date.now() - lastUpdateAt < 300
      ) {
        await delay(100)
      }
      return { didReceiveUpdate: didUpdate, updates }
    } finally {
      db.events.off('update', onUpdate)
    }
  }

  async syncAllOrbitDBRecords(dbAddress: string) {
    if (this.isShuttingDown) return

    syncLog('Starting sync for database:', dbAddress)
    const endTimer = this.metrics.startSyncTimer('all_databases')
    let db: any

    try {
      syncLog('Opening database:', dbAddress)
      db = await this.orbitdb.open(dbAddress)
      syncLog('Opened database:', dbAddress)

      syncLog('Waiting for database update event:', dbAddress)
      const { didReceiveUpdate, updates } = await this.waitForUpdateEvent(db)
      if (!didReceiveUpdate) {
        syncLog('No update event received within timeout:', dbAddress)
      } else {
        syncLog('Received update event for database:', dbAddress, 'updates:', updates.length)
      }

      if (didReceiveUpdate) {
        const updateRecords = updates.map((entry) => ({ value: entry?.payload?.value ?? entry?.value ?? entry }))
        const imageCids = this.extractImageCids(updateRecords)
        syncLog('Extracted media CIDs from updates:', dbAddress, 'count:', imageCids.length)
        this.enqueueImageCidsForPinning(imageCids)
      }

      this.metrics.trackSync('documents', 'success')
      endTimer()
    } catch (err: any) {
      this.metrics.trackSync('documents', 'failure')
      endTimer()
      if (loggingConfig.logLevels.database) {
        // eslint-disable-next-line no-console
        console.error('Failed to sync database:', err)
      }
    } finally {
      try {
        await db?.close?.()
      } catch {
        // ignore close failures
      }
    }
  }

  beginShutdown() {
    this.isShuttingDown = true
  }

  async stop() {
    this.beginShutdown()

    this.pinQueue.pause()
    this.pinQueue.clear()
    await this.pinQueue.onIdle()

    try {
      await this.orbitdb?.stop?.()
    } catch {
      // ignore stop failures
    }
  }
}
