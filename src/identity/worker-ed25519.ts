import { publicKeyFromRaw } from '@libp2p/crypto/keys'

const encoder = new TextEncoder()

const toBytes = (data: any): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (typeof data === 'string') return encoder.encode(data)
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  if (data && typeof data === 'object') {
    if (data.bytes) return toBytes(data.bytes)
    if (data.value) return toBytes(data.value)
    return new Uint8Array(Object.values(data))
  }
  throw new Error('Unsupported worker-ed25519 data')
}

const concatBytes = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

const verifyEd25519Signature = async (
  publicKeyBytes: Uint8Array,
  data: Uint8Array,
  signature: Uint8Array
): Promise<boolean> => {
  const publicKey = publicKeyFromRaw(toBytes(publicKeyBytes))
  return await publicKey.verify(toBytes(data), toBytes(signature))
}

export const inspectWorkerEd25519Identity = async (identity: any) => {
  if (identity?.type !== 'worker-ed25519') {
    return {
      isWorkerEd25519: false,
      valid: false,
    }
  }

  if (!identity?.id || !identity?.publicKey || !identity?.signatures) {
    return {
      isWorkerEd25519: true,
      valid: false,
      missingFields: true,
    }
  }

  const publicKey = toBytes(identity.publicKey)
  const idSignature = toBytes(identity.signatures.id)
  const publicKeySignature = toBytes(identity.signatures.publicKey)
  const didBytes = encoder.encode(identity.id)

  const idValid = await verifyEd25519Signature(publicKey, didBytes, idSignature)
  const publicKeyPayload = concatBytes([publicKey, idSignature])
  const publicKeyValid = idValid
    ? await verifyEd25519Signature(publicKey, publicKeyPayload, publicKeySignature)
    : false

  return {
    isWorkerEd25519: true,
    valid: idValid && publicKeyValid,
    idValid,
    publicKeyValid,
    lengths: {
      didBytes: didBytes.length,
      publicKey: publicKey.length,
      idSignature: idSignature.length,
      publicKeySignature: publicKeySignature.length,
      publicKeyPayload: publicKeyPayload.length,
    },
  }
}

export const verifyWorkerEd25519Identity = async (identity: any): Promise<boolean> => {
  const inspection = await inspectWorkerEd25519Identity(identity)
  return inspection.valid
}
