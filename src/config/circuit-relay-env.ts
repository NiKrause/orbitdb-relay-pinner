/**
 * Circuit relay v2 server limits (see js-libp2p CONFIGURATION.md → circuitRelayServer).
 * Defaults are 10× the previous hardcoded values (v0.3.x) for heavier test / multi-peer workloads.
 */

const TEN = 10

/** Previously 30000 */
export const DEFAULT_RELAY_CIRCUIT_HOP_TIMEOUT_MS = 30000 * TEN

/** Previously 1000 */
export const DEFAULT_RELAY_CIRCUIT_MAX_RESERVATIONS = 1000 * TEN

/** Previously 2 hours */
export const DEFAULT_RELAY_CIRCUIT_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000 * TEN

/** Previously 1 GiB */
export const DEFAULT_RELAY_CIRCUIT_DEFAULT_DATA_LIMIT_BYTES = BigInt(1024 * 1024 * 1024) * BigInt(TEN)

/** Previously 2 minutes */
export const DEFAULT_RELAY_CIRCUIT_DEFAULT_DURATION_LIMIT_MS = 2 * 60 * 1000 * TEN

function envInt(name: string, defaultVal: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultVal
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultVal
}

function envBigInt(name: string, defaultVal: bigint): bigint {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return defaultVal
  try {
    return BigInt(raw)
  } catch {
    return defaultVal
  }
}

export function getCircuitRelayHopTimeoutMs(): number {
  return envInt('RELAY_CIRCUIT_HOP_TIMEOUT_MS', DEFAULT_RELAY_CIRCUIT_HOP_TIMEOUT_MS)
}

export function getCircuitRelayMaxReservations(): number {
  return envInt('RELAY_CIRCUIT_MAX_RESERVATIONS', DEFAULT_RELAY_CIRCUIT_MAX_RESERVATIONS)
}

export function getCircuitRelayReservationTtlMs(): number {
  return envInt('RELAY_CIRCUIT_RESERVATION_TTL_MS', DEFAULT_RELAY_CIRCUIT_RESERVATION_TTL_MS)
}

export function getCircuitRelayDefaultDataLimitBytes(): bigint {
  return envBigInt('RELAY_CIRCUIT_DEFAULT_DATA_LIMIT_BYTES', DEFAULT_RELAY_CIRCUIT_DEFAULT_DATA_LIMIT_BYTES)
}

export function getCircuitRelayDefaultDurationLimitMs(): number {
  return envInt('RELAY_CIRCUIT_DEFAULT_DURATION_LIMIT_MS', DEFAULT_RELAY_CIRCUIT_DEFAULT_DURATION_LIMIT_MS)
}
