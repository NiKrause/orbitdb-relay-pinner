# orbitdb-relay-pinner

OrbitDB relay + pinning/sync service used by our apps and tests.

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

## Why This Exists

- The relay must be able to verify OrbitDB entries created by `did:key` identities.
- This package registers `@orbitdb/identity-provider-did` with a `key-did-resolver` resolver before opening OrbitDB.

## Environment Variables (common)

- `RELAY_TCP_PORT`, `RELAY_WS_PORT`, `RELAY_WEBRTC_PORT`
- `RELAY_DISABLE_WEBRTC=true` to disable UDP `/webrtc-direct` listener in constrained environments
- `METRICS_PORT=0` to bind metrics on an ephemeral port (avoid `EADDRINUSE`)
- `DATASTORE_PATH` or `RELAY_DATASTORE_PATH` to control where LevelDB data is stored
- `PUBSUB_TOPICS` to override pubsub peer discovery topics (default: `todo._peer-discovery._p2p._pubsub`)
- `TEST_PRIVATE_KEY` / `RELAY_PRIV_KEY` for `--test` runs (optional)

## Development

```bash
npm i
npm run build
node dist/cli.js --test
```
