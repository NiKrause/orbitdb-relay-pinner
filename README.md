# orbitdb-relay-pinner

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
- `todo-delegation` (custom delegated todo controller registered by this package)

Notes:

- Existing databases are opened using the manifest `accessController.type`.
- Creating a new database without explicitly passing an `AccessController` still defaults to `orbitdb`.

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

## Docker Compose Example

See `docker-compose.example.yml` for a minimal deployment example with:

- persistent datastore volume (PeerId/key survives restarts)
- relay + metrics ports exposed (`9091/tcp`, `9092/tcp`, `9093/udp`, `9090/tcp`)
- WebRTC enabled and AutoTLS left enabled by default
