import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport, circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { kadDHT, removePrivateAddressesMapper } from '@libp2p/kad-dht'
import { bootstrap } from '@libp2p/bootstrap'
import { tcp } from '@libp2p/tcp'
import { ping } from '@libp2p/ping'
import { autoNAT } from '@libp2p/autonat'
import { dcutr } from '@libp2p/dcutr'
import { autoTLS } from '@ipshipyard/libp2p-auto-tls'
import { keychain } from '@libp2p/keychain'
import { prometheusMetrics } from '@libp2p/prometheus-metrics'
import type { PrivateKey } from '@libp2p/interface'
import type { Datastore } from 'interface-datastore'

const appendAnnounce = (
  process.env.NODE_ENV === 'development' ? process.env.VITE_APPEND_ANNOUNCE_DEV : process.env.VITE_APPEND_ANNOUNCE
) || ''

const appendAnnounceArray = appendAnnounce
  .split(',')
  .map((addr) => addr.trim())
  .filter(Boolean)

const RELAY_TCP_PORT = Number(process.env.RELAY_TCP_PORT || 9091)
const RELAY_WS_PORT = Number(process.env.RELAY_WS_PORT || 9092)
const RELAY_WEBRTC_PORT = Number(process.env.RELAY_WEBRTC_PORT || 9093)
const RELAY_LISTEN_IPV4 = process.env.RELAY_LISTEN_IPV4 || '0.0.0.0'
const RELAY_LISTEN_IPV6 = process.env.RELAY_LISTEN_IPV6 || '::'
const RELAY_DISABLE_IPV6 = process.env.RELAY_DISABLE_IPV6 === 'true' || process.env.RELAY_DISABLE_IPV6 === '1'
const RELAY_DISABLE_WEBRTC =
  process.env.RELAY_DISABLE_WEBRTC === 'true' || process.env.RELAY_DISABLE_WEBRTC === '1'

const PUBSUB_TOPICS = (process.env.PUBSUB_TOPICS || process.env.VITE_PUBSUB_TOPICS || 'todo._peer-discovery._p2p._pubsub')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean)

export const createLibp2pConfig = (privateKey: PrivateKey, datastore: Datastore) =>
  ({
  privateKey,
  datastore,
  metrics: prometheusMetrics(),
  addresses: {
    listen: [
      `/ip4/${RELAY_LISTEN_IPV4}/tcp/${RELAY_TCP_PORT}`,
      `/ip4/${RELAY_LISTEN_IPV4}/tcp/${RELAY_WS_PORT}/ws`,
      ...(!RELAY_DISABLE_WEBRTC ? [`/ip4/${RELAY_LISTEN_IPV4}/udp/${RELAY_WEBRTC_PORT}/webrtc-direct`] : []),
      ...(!RELAY_DISABLE_IPV6
        ? [
            `/ip6/${RELAY_LISTEN_IPV6}/tcp/${RELAY_TCP_PORT}`,
            `/ip6/${RELAY_LISTEN_IPV6}/tcp/${RELAY_WS_PORT}/ws`,
            ...(!RELAY_DISABLE_WEBRTC ? [`/ip6/${RELAY_LISTEN_IPV6}/udp/${RELAY_WEBRTC_PORT}/webrtc-direct`] : []),
          ]
        : []),
    ],
    ...(appendAnnounceArray.length > 0 && { appendAnnounce: appendAnnounceArray }),
  },
  transports: [circuitRelayTransport(), tcp(), ...(!RELAY_DISABLE_WEBRTC ? [webRTC(), webRTCDirect()] : []), webSockets()],
  peerDiscovery: [
    pubsubPeerDiscovery({
      interval: 5000,
      topics: PUBSUB_TOPICS,
      listenOnly: false,
      emitSelf: true,
    } as any),
  ],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    ping: ping(),
    autonat: autoNAT(),
    dcutr: dcutr(),
    aminoDHT: kadDHT({
      protocol: '/ipfs/kad/1.0.0',
      peerInfoMapper: removePrivateAddressesMapper,
    }),
    relay: circuitRelayServer({
      hopTimeout: 30000,
      reservations: {
        maxReservations: 1000,
        reservationTtl: 2 * 60 * 60 * 1000,
        defaultDataLimit: BigInt(1024 * 1024 * 1024),
        defaultDurationLimit: 2 * 60 * 1000,
      },
    }),
    identify: identify(),
    identifyPush: identifyPush(),
    pubsub: gossipsub({ allowPublishToZeroTopicPeers: true }),
    ...(!process.env.disableAutoTLS && {
      autoTLS: autoTLS({
        autoConfirmAddress: true,
        ...(process.env.STAGING === 'true' && {
          acmeDirectory: 'https://acme-staging-v02.api.letsencrypt.org/directory',
        }),
      }),
    }),
    keychain: keychain(),
  },
  connectionGater: {
    denyDialMultiaddr: async () => false,
  },
} as any)
