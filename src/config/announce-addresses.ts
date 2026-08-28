import { multiaddr, type Multiaddr } from '@multiformats/multiaddr'

/**
 * Address hygiene for everything we hand to other peers.
 *
 * These rules used to live in `src/http/pinning-http.ts` and ran only when a
 * caller asked for `/multiaddrs`. libp2p's own announce list was never put
 * through them, so identify and the circuit-relay reservation response kept
 * handing out loopback addresses and certhash-less `webrtc-direct` entries
 * long after the HTTP surface had been cleaned up (see #48).
 *
 * They live here now so the address manager and the HTTP handler apply one
 * predicate instead of two that drift apart.
 */

/** Addresses nobody outside this host can reach. */
export function isPublicAddress(addr: string): boolean {
  if (!addr) return false
  if (addr.includes('/ip4/127.')) return false
  if (addr.includes('/ip4/10.')) return false
  if (addr.includes('/ip4/192.168.')) return false
  const m = addr.match(/\/ip4\/172\.(\d+)\./)
  if (m) {
    const octet = Number(m[1])
    if (octet >= 16 && octet <= 31) return false
  }
  if (addr.includes('/ip6/::1')) return false
  if (addr.includes('/ip6/fc') || addr.includes('/ip6/fd')) return false
  // Link-local. Previously missed, which is how `/ip6/fe80::…/udp/…/quic-v1`
  // survived the filter and reached the published bootstrap record.
  if (addr.includes('/ip6/fe80')) return false
  return true
}

/**
 * Browsers can only dial webrtc-direct/webtransport addresses that carry the
 * listener's certificate hash — the /certhash/ component IS the connection's
 * authentication. The synthesized external announce addresses (appendAnnounce
 * from the guest configure script: public IP + mapped port) are certhash-less
 * strings that libp2p passes through verbatim whenever the webrtc listener
 * did not come up (observed on Aleph VMs: no webrtc listen addresses at all,
 * not even loopback). Advertising them poisons bootstrap registrations with
 * undialable addresses and trips the deploy pipeline's certhash verification.
 *
 * Enrich-or-drop: graft the certhash suffix from a real listener address of
 * the same transport onto bare entries; when no certhash exists anywhere,
 * drop the bare entries instead of advertising them.
 */
export function enrichBrowserTransportCerthash(addrs: string[]): string[] {
  const suffixFor = (transport: string): string | null => {
    for (const addr of addrs) {
      const index = addr.indexOf(`/${transport}/certhash/`)
      if (index === -1) continue
      const tail = addr.slice(index + transport.length + 2)
      const p2pIndex = tail.indexOf('/p2p/')
      return p2pIndex === -1 ? tail : tail.slice(0, p2pIndex)
    }
    return null
  }

  const result: string[] = []
  for (const addr of addrs) {
    const transport = addr.includes('/webrtc-direct')
      ? 'webrtc-direct'
      : addr.includes('/webtransport')
        ? 'webtransport'
        : null
    if (!transport || addr.includes('/certhash/')) {
      result.push(addr)
      continue
    }
    const suffix = suffixFor(transport)
    if (!suffix) continue
    const marker = `/${transport}`
    const markerEnd = addr.indexOf(marker) + marker.length
    result.push(`${addr.slice(0, markerEnd)}/${suffix}${addr.slice(markerEnd)}`)
  }
  return result
}

/**
 * A deployment is anything the guest configure script has told about its
 * outside: a proxy hostname, a public IP, or an external port mapping. Only
 * then do private listener addresses become noise rather than the whole story.
 */
export function isDeployedMode(): boolean {
  return Boolean(
    process.env.PROXY_HOSTNAME?.trim() ||
      process.env.PUBLIC_IPV4?.trim() ||
      process.env.EXTERNAL_TCP_PORT?.trim() ||
      process.env.EXTERNAL_WS_PORT?.trim() ||
      process.env.EXTERNAL_WEBRTC_PORT?.trim() ||
      process.env.EXTERNAL_QUIC_PORT?.trim(),
  )
}

/**
 * Enrich first, then drop what is unreachable — private listener addresses
 * carry the certhash that the synthesized public entries need grafted, so
 * filtering before enriching would throw away the donor.
 *
 * Announcing nothing is worse than announcing something imperfect, so an
 * empty result falls back to the enriched list.
 */
export function filterAnnounceAddresses(addrs: string[]): string[] {
  const enriched = enrichBrowserTransportCerthash(addrs)
  if (!isDeployedMode()) return enriched
  const reachable = enriched.filter(isPublicAddress)
  return reachable.length > 0 ? reachable : enriched
}

/** `addresses.announceFilter` for libp2p, in its Multiaddr shape. */
export function announceFilter(addrs: Multiaddr[]): Multiaddr[] {
  const kept = filterAnnounceAddresses(addrs.map((ma) => ma.toString()))
  const out: Multiaddr[] = []
  for (const addr of kept) {
    try {
      out.push(multiaddr(addr))
    } catch {
      // A grafted string that no longer parses must not take the whole
      // announce list down with it.
    }
  }
  return out
}
