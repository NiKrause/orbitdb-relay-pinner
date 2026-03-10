import { IPFSAccessController as CoreIPFSAccessController } from '@orbitdb/core'
import { verifyIdentityWithFallback } from './shared.js'

const type = 'ipfs'

const IPFSAccessController =
  ({ write, storage }: { write?: string[]; storage?: any } = {}) =>
  async ({ orbitdb, identities, address }: any) => {
    const baseFactory = CoreIPFSAccessController({ write, storage })
    const baseAccess = await baseFactory({ orbitdb, identities, address })

    const canAppend = async (entry: any) => {
      const writerIdentity = await identities.getIdentity(entry.identity)
      if (!writerIdentity) return false

      const writerId = writerIdentity.id
      const allowedWriters = Array.isArray(baseAccess.write) ? baseAccess.write : []
      if (!allowedWriters.includes(writerId) && !allowedWriters.includes('*')) {
        return false
      }

      return await verifyIdentityWithFallback(identities, writerIdentity)
    }

    return {
      ...baseAccess,
      canAppend,
    }
  }

;(IPFSAccessController as any).type = type

export default IPFSAccessController
