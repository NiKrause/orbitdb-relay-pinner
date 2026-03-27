# orbitdb-relay-pinner

[![Build](https://github.com/NiKrause/orbitdb-relay-pinner/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NiKrause/orbitdb-relay-pinner/actions/workflows/ci.yml?query=branch%3Amain)
[![Relay media integration](https://github.com/NiKrause/orbitdb-relay-pinner/actions/workflows/relay-media-integration.yml/badge.svg?branch=main)](https://github.com/NiKrause/orbitdb-relay-pinner/actions/workflows/relay-media-integration.yml?query=branch%3Amain)

OrbitDB relay + pinning/sync service used by our apps and tests.

## AI Agents

See `AGENTS.md` for an architecture and feature guide (entrypoints, data flow, env vars, and extension points).

## Docs

- Relay media pinning flow: `docs/relay-media-pinning.md`

## CLI

Install:

```bash
npm i orbitdb-relay-pinner
```

Run:

```bash
orbitdb-relay-pinner
```

Test mode (deterministic peer id via `TEST_PRIVATE_KEY` or `RELAY_PRIV_KEY`):

```bash
orbitdb-relay-pinner --test
```

## Supported Access Controllers

`orbitdb-relay-pinner` supports the following Access Controller types when opening OrbitDB databases:

- `orbitdb` (built-in OrbitDB access controller)
- `orbitdb-deferred` (custom deferred OrbitDB ACL registered by this package)
- `todo-delegation` — delegated todo writes (same rules as the app; see below)

Notes:

- Existing databases are opened using the manifest `accessController.type`.
- Creating a new database without explicitly passing an `AccessController` still defaults to `orbitdb`.

### `todo-delegation` package

The delegated todo access controller lives in **`@le-space/orbitdb-access-controller-delegated-todo`** (shared with simple-todo) so pinning uses the same `canAppend` and `verifyDelegationWriterIdentity` behavior as the browser. This relay depends on **`^0.1.0`** of that package.

If `npm install` cannot resolve it yet, install from a local checkout of simple-todo:

```bash
npm install ../path/to/simple-todo/packages/orbitdb-access-controller-delegated-todo
```

## Identity providers (OrbitDB)

The relay registers OrbitDB identity providers so it can verify oplog entries from peers that use passkey-backed identities (same stack as `@le-space/orbitdb-identity-provider-webauthn-did`):

- `publickey` — default from `@orbitdb/core`
- `did` — `@orbitdb/identity-provider-did`
- `webauthn` — worker WebAuthn + keystore (e.g. Ed25519 `did:key` via keystore)
- `webauthn-varsig` — hardware varsig identities (verification uses embedded public key only; no passkey on the server)

## Environment Variables (common)

See **`.env.example`** for a full list including **circuit relay v2** tuning (`RELAY_CIRCUIT_*`).

- `RELAY_TCP_PORT`, `RELAY_WS_PORT`, `RELAY_WEBRTC_PORT`
- `RELAY_DISABLE_WEBRTC=true` to disable UDP `/webrtc-direct` listener in constrained environments
- `METRICS_PORT=0` to bind metrics on an ephemeral port (avoid `EADDRINUSE`)
- `DATASTORE_PATH` or `RELAY_DATASTORE_PATH` to control where LevelDB data is stored
- `PUBSUB_TOPICS` to override pubsub peer discovery topics (default: `todo._peer-discovery._p2p._pubsub`)
- `TEST_PRIVATE_KEY` / `RELAY_PRIV_KEY` for `--test` runs (optional)
- **Circuit relay (v0.4+):** `RELAY_CIRCUIT_HOP_TIMEOUT_MS`, `RELAY_CIRCUIT_MAX_RESERVATIONS`, `RELAY_CIRCUIT_RESERVATION_TTL_MS`, `RELAY_CIRCUIT_DEFAULT_DATA_LIMIT_BYTES`, `RELAY_CIRCUIT_DEFAULT_DURATION_LIMIT_MS` — defaults are set to **10×** the pre-0.4 hardcoded limits (see `src/config/circuit-relay-env.ts`).

## Development

Mocha suites live under **`mocha/`** (not `test/`) so **`node --test`** (Node’s built-in runner) does not auto-load them; those files use Mocha’s `describe` / `it`. Run **`npm test`** for Mocha.

```bash
npm i
npm run build
node dist/cli.js --test
```

## Docker Compose Example

See `docker-compose.example.yml` for a minimal deployment example with:

- persistent datastore volume (PeerId/key survives restarts)
- relay + metrics ports exposed (`9091/tcp`, `9092/tcp`, `9093/udp`, `9090/tcp`)
- WebRTC enabled and AutoTLS left enabled by default
