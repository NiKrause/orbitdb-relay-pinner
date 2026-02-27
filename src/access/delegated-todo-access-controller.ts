import { OrbitDBAccessController } from '@orbitdb/core'

const type = 'todo-delegation'

const isUnsupportedVarsigHeaderError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  return /Unsupported varsig header/i.test(error.message)
}

export const verifyIdentityWithFallback = async (identities: any, writerIdentity: any): Promise<boolean> => {
  try {
    return await identities.verifyIdentity(writerIdentity)
  } catch (error) {
    const fallback = identities?.verifyIdentityFallback
    if (!isUnsupportedVarsigHeaderError(error) || typeof fallback !== 'function') {
      throw error
    }
    return await fallback(writerIdentity)
  }
}

function parseDelegationActionKey(key: unknown): { taskKey: string; delegateDid: string } | null {
  if (typeof key !== 'string') return null
  const match = /^delegation-action\/([^/]+)\/([^/]+)\/[^/]+$/.exec(key)
  if (!match) return null
  try {
    return {
      taskKey: match[1],
      delegateDid: decodeURIComponent(match[2])
    }
  } catch {
    return null
  }
}

const DelegatedTodoAccessController =
  ({ write }: { write?: string[] } = {}) =>
  async ({ orbitdb, identities, address, name }: any) => {
    const baseFactory = OrbitDBAccessController({ write })
    const baseAccess = await baseFactory({ orbitdb, identities, address, name })

    const canAppend = async (entry: any) => {
      if (await baseAccess.canAppend(entry)) {
        return true
      }

      const payload = entry?.payload
      if (!payload || payload.op !== 'PUT') return false

      const parsedKey = parseDelegationActionKey(payload.key)
      if (!parsedKey) return false

      const value = payload.value
      if (!value || value.type !== 'delegation-action') return false
      if (!['set-completed', 'patch-fields'].includes(value.action)) return false

      if (value.action === 'set-completed' && typeof value.setCompleted !== 'boolean') {
        return false
      }

      if (value.action === 'patch-fields') {
        if (!value.patch || typeof value.patch !== 'object') return false

        const allowedPatchKeys = ['text', 'description']
        const patchKeys = Object.keys(value.patch)
        if (patchKeys.length === 0) return false
        if (!patchKeys.every((k) => allowedPatchKeys.includes(k))) return false
        if (value.patch.text !== undefined && typeof value.patch.text !== 'string') return false
        if (value.patch.description !== undefined && typeof value.patch.description !== 'string') {
          return false
        }
      }

      if (value.taskKey !== parsedKey.taskKey) return false
      if (value.delegateDid !== parsedKey.delegateDid) return false

      if (value.expiresAt && Date.parse(value.expiresAt) < Date.now()) return false

      const writerIdentity = await identities.getIdentity(entry.identity)
      if (!writerIdentity) return false
      if (!(await verifyIdentityWithFallback(identities, writerIdentity))) return false

      return writerIdentity.id === value.delegateDid
    }

    return {
      ...baseAccess,
      type,
      canAppend
    }
  }

;(DelegatedTodoAccessController as any).type = type

export default DelegatedTodoAccessController
