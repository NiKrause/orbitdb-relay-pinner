import { randomBytes } from 'node:crypto'
import { verifyIdentityWithFallback } from './shared.js'
import IPFSAccessController from './ipfs-access-controller.js'

const type = 'orbitdb-deferred'
const DEFAULT_ACL_SYNC_TIMEOUT = 5000
const CUSTOM_PREFIX = '/orbitdb-deferred/'
const ORBITDB_PREFIX = '/orbitdb/'

const createLocalId = (length = 64): string => {
  const bytes = randomBytes(length)
  return bytes.toString('hex').slice(0, length)
}

const toUnderlyingAddress = (address?: string | null): string | undefined | null => {
  if (!address || typeof address !== 'string') return address
  if (!address.startsWith(CUSTOM_PREFIX)) return address
  return `${ORBITDB_PREFIX}${address.slice(CUSTOM_PREFIX.length)}`
}

const toCustomAddress = (address?: string | null): string | undefined | null => {
  if (!address || typeof address !== 'string') return address
  if (!address.startsWith(ORBITDB_PREFIX)) return address
  return `${CUSTOM_PREFIX}${address.slice(ORBITDB_PREFIX.length)}`
}

const DeferredOrbitDBAccessController =
  ({ write, syncTimeout = DEFAULT_ACL_SYNC_TIMEOUT }: { write?: string[]; syncTimeout?: number } = {}) =>
  async ({ orbitdb, identities, address, name }: any) => {
    const aclAddress = toUnderlyingAddress(address || name || createLocalId(64))
    write = write || [orbitdb.identity.id]

    const db = await orbitdb.open(aclAddress, {
      type: 'keyvalue',
      AccessController: IPFSAccessController({ write }),
    })

    let aclActivitySeen = false
    let resolveAclActivity: (() => void) | null = null
    const aclActivityPromise = new Promise<void>((resolve) => {
      resolveAclActivity = () => {
        aclActivitySeen = true
        resolve()
      }
    })

    const markAclActivity = () => {
      if (aclActivitySeen) return
      resolveAclActivity?.()
    }

    db.events.on('update', markAclActivity)
    db.events.on('join', markAclActivity)

    const capabilities = async () => {
      const currentCapabilities: Record<string, Set<string>> = {}
      for await (const entry of db.iterator()) {
        currentCapabilities[entry.key] = new Set(entry.value || [])
      }

      currentCapabilities.admin = new Set([
        ...(currentCapabilities.admin || []),
        ...(db.access.write || []),
      ])

      return currentCapabilities
    }

    const get = async (capability: string) => {
      const currentCapabilities = await capabilities()
      return currentCapabilities[capability] || new Set([])
    }

    const hasCapability = async (capability: string, key: string) => {
      const access = new Set(await get(capability))
      return access.has(key) || access.has('*')
    }

    const waitForAclReplication = async () => {
      if (aclActivitySeen) return
      if ((db.peers?.size || 0) === 0) return

      await Promise.race([
        aclActivityPromise,
        new Promise((resolve) => setTimeout(resolve, syncTimeout)),
      ])
    }

    const canAppend = async (entry: any) => {
      const writerIdentity = await identities.getIdentity(entry.identity)
      if (!writerIdentity) return false

      const { id } = writerIdentity
      let hasWriteAccess =
        await hasCapability('write', id) || await hasCapability('admin', id)

      if (!hasWriteAccess) {
        await waitForAclReplication()
        hasWriteAccess =
          await hasCapability('write', id) || await hasCapability('admin', id)
      }

      if (!hasWriteAccess) return false
      return await verifyIdentityWithFallback(identities, writerIdentity)
    }

    const grant = async (capability: string, key: string) => {
      const nextCapabilities = new Set([...(await db.get(capability) || []), key])
      await db.put(capability, Array.from(nextCapabilities.values()))
    }

    const revoke = async (capability: string, key: string) => {
      const nextCapabilities = new Set(await db.get(capability) || [])
      nextCapabilities.delete(key)
      if (nextCapabilities.size > 0) {
        await db.put(capability, Array.from(nextCapabilities.values()))
      } else {
        await db.del(capability)
      }
    }

    return {
      type,
      address: toCustomAddress(db.address?.toString?.() || db.address),
      write,
      debugDb: db,
      canAppend,
      capabilities,
      get,
      grant,
      revoke,
      close: async () => db.close(),
      drop: async () => db.drop(),
      events: db.events,
    }
  }

;(DeferredOrbitDBAccessController as any).type = type

export default DeferredOrbitDBAccessController
