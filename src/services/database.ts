import { createOrbitDB, Identities, parseAddress, useAccessController, useIdentityProvider } from '@orbitdb/core'
import {
  OrbitDBWebAuthnIdentityProviderFunction,
  verifyVarsigIdentity
} from '@le-space/orbitdb-identity-provider-webauthn-did'
import OrbitDBIdentityProviderDID from '@orbitdb/identity-provider-did'
import * as KeyDIDResolver from 'key-did-resolver'
import { CID } from 'multiformats/cid'
import * as Block from 'multiformats/block'
import * as dagCbor from '@ipld/dag-cbor'
import { sha256 } from 'multiformats/hashes/sha2'
import { base58btc } from 'multiformats/bases/base58'
import { setTimeout as delay } from 'node:timers/promises'
import { inspect } from 'node:util'
import PQueue from 'p-queue'

import { MetricsServer } from './metrics.js'
import { log, syncLog, logSyncStats } from '../utils/logger.js'
import { loggingConfig } from '../config/logging.js'
import IPFSAccessController from '../access/ipfs-access-controller.js'
import DelegatedTodoAccessController from '../access/delegated-todo-access-controller.js'
import DeferredOrbitDBAccessController from '../access/deferred-orbitdb-access-controller.js'
import { verifyIdentityWithFallback } from '../access/shared.js'
import { inspectWorkerEd25519Identity, verifyWorkerEd25519Identity } from '../identity/worker-ed25519.js'

const DEFERRED_ACL_PREFIX = '/orbitdb-deferred/'
const ORBITDB_PREFIX = '/orbitdb/'

export class DatabaseService {
  metrics: MetricsServer
  identityDatabases: Map<string, any>
  databaseContexts: Map<string, any>
  updateTimers: Map<string, any>
  eventHandlers: Map<string, any>
  syncInFlight: Map<string, Promise<void>>
  openInFlight: Map<string, Promise<any>>
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
    this.syncInFlight = new Map()
    this.openInFlight = new Map()
    this.pinQueue = new PQueue({ concurrency: 4 })
    this.queuedImageCids = new Set()
    this.pinnedImageCids = new Set()
    this.isShuttingDown = false
  }

  async initialize(ipfs: any, directory?: string) {
    OrbitDBIdentityProviderDID.setDIDResolver(KeyDIDResolver.getResolver())
    useIdentityProvider(OrbitDBIdentityProviderDID as any)
    // Worker WebAuthn + keystore (type: webauthn); hardware varsig (type: webauthn-varsig)
    useIdentityProvider(OrbitDBWebAuthnIdentityProviderFunction as any)
    useIdentityProvider({
      type: 'webauthn-varsig',
      verifyIdentity: verifyVarsigIdentity
    } as any)
    useAccessController(IPFSAccessController as any)
    useAccessController(DelegatedTodoAccessController as any)
    useAccessController(DeferredOrbitDBAccessController as any)
    this.ipfs = ipfs

    // Add a fallback verifier for mixed writer modes (e.g. varsig + non-varsig DID signatures).
    const baseIdentities = await Identities({ ipfs })
    const relayIdentities = {
      ...baseIdentities,
      // Only run DID JWS verification for `did` identities. The DID provider's verifyIdentity
      // builds a JWS from signatures.publicKey; calling it for webauthn / varsig shapes hits
      // dids ("No kid found in jws") or unhandled rejections because verifyJWS is not awaited upstream.
      verifyIdentityFallback: async (identity: any) => {
        if (!identity) return false
        const t = identity?.type
        if (t === 'did') {
          try {
            return await OrbitDBIdentityProviderDID.verifyIdentity(identity)
          } catch {
            return false
          }
        }
        if (t === 'webauthn' && typeof (OrbitDBWebAuthnIdentityProviderFunction as any).verifyIdentity === 'function') {
          try {
            return await (OrbitDBWebAuthnIdentityProviderFunction as any).verifyIdentity(identity)
          } catch {
            return false
          }
        }
        if (t === 'webauthn-varsig') {
          try {
            return await verifyVarsigIdentity(identity)
          } catch {
            return false
          }
        }
        try {
          return await verifyWorkerEd25519Identity(identity)
        } catch {
          return false
        }
      }
    }

    this.orbitdb = await createOrbitDB({
      ipfs,
      identities: relayIdentities,
      ...(directory ? { directory } : {})
    })
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

  private normalizeOrbitdbAccessAddress(address: string | null): string | null {
    if (!address || typeof address !== 'string') return null
    if (address.startsWith(DEFERRED_ACL_PREFIX)) {
      return `${ORBITDB_PREFIX}${address.slice(DEFERRED_ACL_PREFIX.length)}`
    }
    return address.startsWith(ORBITDB_PREFIX) ? address : null
  }

  private summarizeManifest(manifest: any, dbAddress: string, cid: string) {
    return {
      dbAddress,
      manifestCid: cid,
      name: manifest?.name || null,
      type: manifest?.type || null,
      accessController: manifest?.accessController || null,
      meta: manifest?.meta || null,
    }
  }

  private async loadManifest(dbAddress: string): Promise<any | null> {
    try {
      const orbitAddress = parseAddress(dbAddress)
      const cid = CID.parse(orbitAddress.hash, base58btc)
      syncLog('Loading OrbitDB manifest block:', inspect({
        dbAddress,
        manifestCid: cid.toString(),
      }, { depth: null, colors: false, compact: false }))
      const bytes = await this.ipfs.blockstore.get(cid)
      const { value } = await Block.decode({ bytes, codec: dagCbor, hasher: sha256 })
      syncLog(
        'Loaded OrbitDB manifest block:',
        inspect(this.summarizeManifest(value || null, dbAddress, cid.toString()), {
          depth: null,
          colors: false,
          compact: false,
        })
      )
      return value || null
    } catch (error: any) {
      if (loggingConfig.logLevels.database) {
        // eslint-disable-next-line no-console
        console.warn('Failed to load OrbitDB manifest before sync:', {
          dbAddress,
          error: error?.message || String(error),
        })
      }
      return null
    }
  }

  private async waitForDatabaseActivity(
    db: any,
    timeoutMs = 5000
  ): Promise<{ didReceiveActivity: boolean; activity: 'join' | 'update' | null }> {
    if (!db?.events?.on || !db?.events?.off) {
      return { didReceiveActivity: false, activity: null }
    }

    let didReceiveActivity = false
    let activity: 'join' | 'update' | null = null

    const onJoin = () => {
      didReceiveActivity = true
      activity = activity || 'join'
    }

    const onUpdate = () => {
      didReceiveActivity = true
      activity = 'update'
    }

    db.events.on('join', onJoin)
    db.events.on('update', onUpdate)

    try {
      const startedAt = Date.now()
      while (!didReceiveActivity && !this.isShuttingDown && Date.now() - startedAt < timeoutMs) {
        await delay(100)
      }

      return { didReceiveActivity, activity }
    } finally {
      db.events.off('join', onJoin)
      db.events.off('update', onUpdate)
    }
  }

  private async waitForDatabaseHeads(
    db: any,
    timeoutMs = 20000
  ): Promise<{ didReceiveHeads: boolean; headCount: number; headHashes: string[] }> {
    const startedAt = Date.now()

    while (!this.isShuttingDown && Date.now() - startedAt < timeoutMs) {
      try {
        if (db?.log?.heads) {
          const heads = await db.log.heads()
          const headHashes = heads.map((entry: any) => entry?.hash).filter(Boolean)
          if (headHashes.length > 0) {
            return {
              didReceiveHeads: true,
              headCount: headHashes.length,
              headHashes,
            }
          }
        }
      } catch {}

      await delay(250)
    }

    return {
      didReceiveHeads: false,
      headCount: 0,
      headHashes: [],
    }
  }

  private async preOpenAccessController(dbAddress: string, timeoutMs = 20000): Promise<any | null> {
    const manifest = await this.loadManifest(dbAddress)
    const accessControllerAddress = this.normalizeOrbitdbAccessAddress(manifest?.accessController || null)

    if (!accessControllerAddress) {
      syncLog('No pre-openable OrbitDB access controller found for database:', dbAddress)
      return null
    }

    syncLog('Pre-opening access controller before database sync:', dbAddress, 'acl:', accessControllerAddress)
    const aclDb = await this.openDatabase(accessControllerAddress)
    this.installAccessControllerDebugHooks(aclDb, accessControllerAddress)
    syncLog(
      'Access-controller state after open:',
      inspect(await this.snapshotDatabaseState(aclDb, 'acl-open'), { depth: null, colors: false, compact: false })
    )

    const { didReceiveActivity, activity } = await this.waitForDatabaseActivity(aclDb, timeoutMs)
    const headStatus = await this.waitForDatabaseHeads(aclDb, timeoutMs)
    if (!didReceiveActivity) {
      syncLog(
        'No access-controller activity received within timeout:',
        accessControllerAddress,
        inspect(await this.snapshotDatabaseState(aclDb, 'acl-timeout'), { depth: null, colors: false, compact: false })
      )
    } else {
      syncLog(
        'Access-controller activity observed before database sync:',
        accessControllerAddress,
        'activity:',
        activity,
        inspect(await this.snapshotDatabaseState(aclDb, 'acl-activity'), { depth: null, colors: false, compact: false })
      )
    }
    if (!headStatus.didReceiveHeads) {
      syncLog(
        'No access-controller heads received within timeout:',
        accessControllerAddress,
        inspect(await this.snapshotDatabaseState(aclDb, 'acl-head-timeout'), { depth: null, colors: false, compact: false })
      )
    } else {
      syncLog(
        'Access-controller heads became visible before database sync:',
        accessControllerAddress,
        inspect(headStatus, { depth: null, colors: false, compact: false })
      )
    }

    return aclDb
  }

  private async openDatabase(dbAddress: string): Promise<any> {
    const existing = this.openInFlight.get(dbAddress)
    if (existing) {
      syncLog('Open already in progress for database, waiting on existing open:', dbAddress)
      return await existing
    }

    const openPromise = this.orbitdb.open(dbAddress)
    this.openInFlight.set(dbAddress, openPromise)
    try {
      return await openPromise
    } finally {
      this.openInFlight.delete(dbAddress)
    }
  }


  private installAccessControllerDebugHooks(db: any, dbAddress: string) {
    if (!loggingConfig.enableSyncLogs) return
    try {
      const access = db?.access
      const canAppend = access?.canAppend
      if (typeof canAppend !== 'function' || access.__debugCanAppendWrapped) return

      const wrapped = async (entry: any) => {
        const allowed = await canAppend.call(access, entry)
        if (!allowed) {
          const payload = entry?.payload || null
          const value = payload?.value || null
          const writerIdentityHash = entry?.identity || null
          const writerKey = entry?.key || null
          const identityDebug = await this.collectDatabaseIdentityDebug(db, writerIdentityHash)
          // eslint-disable-next-line no-console
          console.warn(
            '🚫 Relay AC rejected append',
            inspect({
              dbAddress,
              dbName: db?.name || null,
              accessType: access?.type || null,
              writerIdentityHash,
              writerKey,
              payloadOp: payload?.op || null,
              payloadKey: payload?.key || null,
              valueType: value?.type || null,
              valueAction: value?.action || null,
              valueTaskKey: value?.taskKey || null,
              valueDelegateDid: value?.delegateDid || null,
              valuePerformedBy: value?.performedBy || null,
              valueExpiresAt: value?.expiresAt || null,
              identityDebug,
            }, { depth: null, colors: false, compact: false })
          )
        }
        return allowed
      }

      access.canAppend = wrapped
      access.__debugCanAppendWrapped = true
      // eslint-disable-next-line no-console
      console.log('🔍 Relay AC debug hook installed', {
        dbAddress,
        dbName: db?.name || null,
        accessType: access?.type || null
      })
    } catch (error: any) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ Failed to install relay AC debug hook', {
        dbAddress,
        error: error?.message || String(error)
      })
    }
  }

  private async inspectIdentityHash(hash: string | null | undefined) {
    if (!hash) return null
    try {
      const identity = await this.orbitdb?.identities?.getIdentity?.(hash)
      if (!identity) {
        return { hash, found: false }
      }

      let baseVerified: boolean | null = null
      let baseError: string | null = null
      try {
        baseVerified = await this.orbitdb.identities.verifyIdentity(identity)
      } catch (error: any) {
        baseError = error?.message || String(error)
      }

      let fallbackVerified: boolean | null = null
      try {
        fallbackVerified = await verifyIdentityWithFallback(this.orbitdb.identities, identity)
      } catch (error: any) {
        return {
          hash,
          found: true,
          id: identity.id || null,
          type: identity.type || null,
          baseVerified,
          baseError,
          fallbackVerified: null,
          fallbackError: error?.message || String(error),
        }
      }

      return {
        hash,
        found: true,
        id: identity.id || null,
        type: identity.type || null,
        baseVerified,
        baseError,
        fallbackVerified,
        workerEd25519Debug:
          identity?.type === 'worker-ed25519'
            ? await inspectWorkerEd25519Identity(identity)
            : null,
      }
    } catch (error: any) {
      return {
        hash,
        found: false,
        error: error?.message || String(error),
      }
    }
  }

  private async collectIdentityHashesFromLog(db: any, label: string, limit = 20) {
    const hashes = new Set<string>()
    try {
      for await (const entry of db?.log?.iterator?.() || []) {
        if (typeof entry?.identity === 'string') hashes.add(entry.identity)
        if (hashes.size >= limit) break
      }
    } catch (error: any) {
      return {
        label,
        error: error?.message || String(error),
        identities: [],
      }
    }

    const identities = []
    for (const hash of hashes) {
      identities.push(await this.inspectIdentityHash(hash))
    }

    return {
      label,
      count: identities.length,
      identities,
    }
  }

  private async snapshotDatabaseState(db: any, label: string) {
    let headHashes: string[] = []
    let headCount = 0
    let peerCount = 0

    try {
      if (db?.log?.heads) {
        const heads = await db.log.heads()
        headHashes = heads.map((entry: any) => entry?.hash).filter(Boolean)
        headCount = headHashes.length
      }
    } catch {}

    try {
      peerCount = db?.peers?.size || 0
    } catch {}

    return {
      label,
      address: db?.address?.toString?.() || db?.address || null,
      name: db?.name || null,
      type: db?.access?.type || null,
      headCount,
      headHashes,
      peerCount,
    }
  }

  private async collectDatabaseIdentityDebug(db: any, writerIdentityHash: string | null) {
    const writer = await this.inspectIdentityHash(writerIdentityHash)
    const logs: any[] = []
    logs.push(await this.collectIdentityHashesFromLog(db, 'db-log'))

    const aclDebugDb = db?.access?.debugDb
    if (aclDebugDb) {
      logs.push(await this.collectIdentityHashesFromLog(aclDebugDb, 'acl-log'))
    }

    return {
      writer,
      state: await this.snapshotDatabaseState(db, 'db'),
      logs,
      aclState: aclDebugDb ? await this.snapshotDatabaseState(aclDebugDb, 'acl') : null,
    }
  }

  async syncAllOrbitDBRecords(dbAddress: string) {
    if (this.isShuttingDown) return
    const existing = this.syncInFlight.get(dbAddress)
    if (existing) {
      syncLog('Sync already in progress for database, skipping duplicate request:', dbAddress)
      await existing
      return
    }

    const syncPromise = (async () => {
      syncLog('Starting sync for database:', dbAddress)
      const endTimer = this.metrics.startSyncTimer('all_databases')
      let db: any
      let aclDb: any

      try {
        aclDb = await this.preOpenAccessController(dbAddress)
        syncLog('Opening database:', dbAddress)
        db = await this.openDatabase(dbAddress)
        syncLog('Opened database:', dbAddress)
        this.installAccessControllerDebugHooks(db, dbAddress)

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
        try {
          if (aclDb && aclDb !== db) {
            await aclDb.close?.()
          }
        } catch {
          // ignore close failures
        }
      }
    })()

    this.syncInFlight.set(dbAddress, syncPromise)
    try {
      await syncPromise
    } finally {
      this.syncInFlight.delete(dbAddress)
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
