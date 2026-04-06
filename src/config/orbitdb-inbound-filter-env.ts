/** When true, inbound peers must advertise at least one `/orbitdb/heads/*` libp2p protocol (from Identify). */
export function isRelayRequireOrbitdbHeadsProtocolEnabled(): boolean {
  const v = process.env.RELAY_REQUIRE_ORBITDB_HEADS_PROTOCOL?.trim().toLowerCase()
  return v === '1' || v === 'true'
}
