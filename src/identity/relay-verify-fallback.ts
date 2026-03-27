import {
  OrbitDBWebAuthnIdentityProviderFunction,
  verifyVarsigIdentity
} from '@le-space/orbitdb-identity-provider-webauthn-did'
import OrbitDBIdentityProviderDID from '@orbitdb/identity-provider-did'

import { verifyWorkerEd25519Identity } from './worker-ed25519.js'

/**
 * Injectable verifiers for {@link createRelayVerifyIdentityFallback} (production defaults + tests).
 */
export type RelayVerifyIdentityDeps = {
  verifyDidIdentity: (identity: any) => Promise<boolean>
  verifyWebauthnIdentity: (identity: any) => Promise<boolean>
  verifyVarsigIdentity: (identity: any) => Promise<boolean>
  verifyWorkerEd25519Identity: (identity: any) => Promise<boolean>
}

/**
 * Same routing as the OrbitDB `identities.verifyIdentityFallback` used by the relay, so mixed
 * writer modes (did, worker WebAuthn, hardware varsig, worker-ed25519) verify without throwing on
 * unsupported primary `verifyIdentity` shapes.
 */
export function createRelayVerifyIdentityFallback(
  deps: RelayVerifyIdentityDeps
): (identity: any) => Promise<boolean> {
  return async (identity: any) => {
    if (!identity) return false
    const t = identity?.type
    if (t === 'did') {
      try {
        return await deps.verifyDidIdentity(identity)
      } catch {
        return false
      }
    }
    if (t === 'webauthn' && typeof (OrbitDBWebAuthnIdentityProviderFunction as any).verifyIdentity === 'function') {
      try {
        return await deps.verifyWebauthnIdentity(identity)
      } catch {
        return false
      }
    }
    if (t === 'webauthn-varsig') {
      try {
        return await deps.verifyVarsigIdentity(identity)
      } catch {
        return false
      }
    }
    try {
      return await deps.verifyWorkerEd25519Identity(identity)
    } catch {
      return false
    }
  }
}

export function defaultRelayVerifyIdentityDeps(): RelayVerifyIdentityDeps {
  return {
    verifyDidIdentity: async (identity: any) => await OrbitDBIdentityProviderDID.verifyIdentity(identity),
    verifyWebauthnIdentity: async (identity: any) =>
      await (OrbitDBWebAuthnIdentityProviderFunction as any).verifyIdentity(identity),
    verifyVarsigIdentity: async (identity: any) => await verifyVarsigIdentity(identity),
    verifyWorkerEd25519Identity: verifyWorkerEd25519Identity,
  }
}
