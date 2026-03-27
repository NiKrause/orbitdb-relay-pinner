/**
 * Routes the same identity.mode combinations as simple-todo E2E
 * (`e2e/simple-todo-webauthn-delegation.spec.js`) to OrbitDB `identity.type` values:
 * - Worker (software WebAuthn in worker) → `webauthn`
 * - Hardware (passkey / varsig) → `webauthn-varsig` (P-256 and Ed25519 both use varsig verification)
 *
 * Full browser WebAuthn + delegation flows stay in simple-todo Playwright; here we lock down
 * relay routing so each mode dispatches to the expected verifier.
 */

import assert from 'node:assert/strict'

describe('relay verifyIdentityFallback routing (simple-todo mode matrix)', function () {
  let createRelayVerifyIdentityFallback

  before(async () => {
    ;({ createRelayVerifyIdentityFallback } = await import('../dist/identity/relay-verify-fallback.js'))
  })

  /** Maps simple-todo auth labels to OrbitDB identity.type (see simple-todo `p2p.js`). */
  const T = {
    worker: 'webauthn',
    hardware: 'webauthn-varsig',
  }

  function makeSpiedFallback() {
    const spy = { did: 0, webauthn: 0, varsig: 0, workerEd25519: 0 }
    const deps = {
      verifyDidIdentity: async () => {
        spy.did++
        return true
      },
      verifyWebauthnIdentity: async () => {
        spy.webauthn++
        return true
      },
      verifyVarsigIdentity: async () => {
        spy.varsig++
        return true
      },
      verifyWorkerEd25519Identity: async () => {
        spy.workerEd25519++
        return true
      },
    }
    const fallback = createRelayVerifyIdentityFallback(deps)
    return { fallback, spy }
  }

  /** Same cases as `runDelegatedFlowForModeCombination` matrix in simple-todo. */
  const MATRIX = [
    {
      id: 'alice-worker-bob-hardware-ed25519',
      alice: T.worker,
      bob: T.hardware,
    },
    {
      id: 'alice-worker-bob-hardware-p256',
      alice: T.worker,
      bob: T.hardware,
    },
    {
      id: 'alice-hardware-ed25519-bob-hardware-p256',
      alice: T.hardware,
      bob: T.hardware,
    },
    {
      id: 'alice-worker-ed25519-bob-worker-ed25519',
      alice: T.worker,
      bob: T.worker,
    },
    {
      id: 'alice-hardware-ed25519-bob-hardware-ed25519',
      alice: T.hardware,
      bob: T.hardware,
    },
    {
      id: 'alice-hardware-p256-bob-hardware-p256',
      alice: T.hardware,
      bob: T.hardware,
    },
  ]

  for (const row of MATRIX) {
    it(`dispatches ${row.id} (alice type → bob type)`, async () => {
      const { fallback, spy } = makeSpiedFallback()
      const aliceIdentity = { type: row.alice, id: 'did:key:alice' }
      const bobIdentity = { type: row.bob, id: 'did:key:bob' }

      assert.equal(await fallback(aliceIdentity), true)
      assert.equal(await fallback(bobIdentity), true)

      const expectWebauthn =
        (row.alice === 'webauthn' ? 1 : 0) + (row.bob === 'webauthn' ? 1 : 0)
      const expectVarsig =
        (row.alice === 'webauthn-varsig' ? 1 : 0) + (row.bob === 'webauthn-varsig' ? 1 : 0)

      assert.equal(spy.webauthn, expectWebauthn, row.id)
      assert.equal(spy.varsig, expectVarsig, row.id)
      assert.equal(spy.did, 0)
      assert.equal(spy.workerEd25519, 0)
    })
  }

  it('routes did identities to verifyDidIdentity', async () => {
    const { fallback, spy } = makeSpiedFallback()
    assert.equal(await fallback({ type: 'did', id: 'did:key:test' }), true)
    assert.equal(spy.did, 1)
    assert.equal(spy.webauthn + spy.varsig + spy.workerEd25519, 0)
  })

  it('routes worker-ed25519 to verifyWorkerEd25519Identity', async () => {
    const { fallback, spy } = makeSpiedFallback()
    assert.equal(await fallback({ type: 'worker-ed25519', id: 'x' }), true)
    assert.equal(spy.workerEd25519, 1)
    assert.equal(spy.did + spy.webauthn + spy.varsig, 0)
  })
})
