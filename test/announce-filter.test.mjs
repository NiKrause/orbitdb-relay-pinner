import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
	announceFilter,
	filterAnnounceAddresses,
	isPublicAddress,
} from '../dist/config/announce-addresses.js'
import { multiaddr } from '@multiformats/multiaddr'

const PEER = '/p2p/12D3KooWExample'
const DEPLOYED = 'EXTERNAL_WS_PORT'

/** Run `fn` with the relay looking deployed, then restore the environment. */
function asDeployed(fn) {
	const previous = process.env[DEPLOYED]
	process.env[DEPLOYED] = '40946'
	try {
		return fn()
	} finally {
		if (previous === undefined) delete process.env[DEPLOYED]
		else process.env[DEPLOYED] = previous
	}
}

test('link-local addresses are not public', () => {
	assert.equal(isPublicAddress('/ip6/fe80::5054:ff:fe12:3456/udp/9094/quic-v1'), false)
	assert.equal(isPublicAddress('/ip4/127.0.0.1/tcp/9092/ws'), false)
	assert.equal(isPublicAddress('/ip4/172.16.13.2/tcp/9092/tls/ws'), false)
	assert.equal(isPublicAddress('/ip6/::1/tcp/9091'), false)
	assert.equal(isPublicAddress('/ip4/62.141.40.252/tcp/40946/ws'), true)
})

test('deployed mode drops the private addresses peers used to receive', () => {
	const raw = [
		`/ip4/127.0.0.1/tcp/9092/ws${PEER}`,
		`/ip4/172.16.13.2/tcp/9092/tls/ws${PEER}`,
		`/ip6/::1/tcp/9091${PEER}`,
		`/ip6/fe80::5054:ff:fe12:3456/udp/9094/quic-v1${PEER}`,
		`/ip4/62.141.40.252/tcp/40946/ws${PEER}`,
	]
	const out = asDeployed(() => filterAnnounceAddresses(raw))
	assert.deepEqual(out, [`/ip4/62.141.40.252/tcp/40946/ws${PEER}`])
})

test('certhash-less webrtc-direct is dropped when no listener can donate one', () => {
	const raw = [
		`/ip4/62.141.40.252/udp/40947/webrtc-direct${PEER}`,
		`/ip4/62.141.40.252/tcp/40946/ws${PEER}`,
	]
	const out = asDeployed(() => filterAnnounceAddresses(raw))
	assert.deepEqual(out, [`/ip4/62.141.40.252/tcp/40946/ws${PEER}`])
})

test('a private listener still donates its certhash before being dropped', () => {
	const raw = [
		`/ip4/127.0.0.1/udp/9093/webrtc-direct/certhash/uEiAAAA${PEER}`,
		`/ip4/62.141.40.252/udp/40947/webrtc-direct${PEER}`,
	]
	const out = asDeployed(() => filterAnnounceAddresses(raw))
	assert.deepEqual(out, [`/ip4/62.141.40.252/udp/40947/webrtc-direct/certhash/uEiAAAA${PEER}`])
})

test('development mode keeps everything', () => {
	const raw = [`/ip4/127.0.0.1/tcp/9092/ws${PEER}`, `/ip4/62.141.40.252/tcp/40946/ws${PEER}`]
	assert.deepEqual(filterAnnounceAddresses(raw), raw)
})

test('announcing nothing is worse than announcing something imperfect', () => {
	const raw = [`/ip4/127.0.0.1/tcp/9092/ws${PEER}`, `/ip6/::1/tcp/9091${PEER}`]
	const out = asDeployed(() => filterAnnounceAddresses(raw))
	assert.deepEqual(out, raw, 'an empty public set must fall back rather than silence the relay')
})

test('announceFilter round-trips Multiaddr objects', () => {
	const raw = [
		multiaddr(`/ip4/127.0.0.1/tcp/9092/ws${PEER}`),
		multiaddr(`/ip4/62.141.40.252/tcp/40946/ws${PEER}`),
	]
	const out = asDeployed(() => announceFilter(raw))
	assert.equal(out.length, 1)
	assert.equal(out[0].toString(), `/ip4/62.141.40.252/tcp/40946/ws${PEER}`)
})
