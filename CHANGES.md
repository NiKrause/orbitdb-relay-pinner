# Changes

## v0.7.1

- Added non-fatal OrbitDB database error handlers so emitted `error` events are logged with database context instead of surfacing as unhandled runtime failures during sync.
- Keeps the `0.7.0` libp2p replication-service release intact while addressing follow-up operational stability seen after publishing.
- Verified with `npm test` and `npm pack --dry-run`.

### Release note

This is a patch release for the `0.7.x` line. It keeps the new embeddable libp2p OrbitDB replication service from `0.7.0`, while hardening the relay against non-fatal OrbitDB sync errors by logging them with enough context to debug production issues safely.

## v0.7.0

- Exported `orbitdbReplicationService()` so OrbitDB replication and Helia-backed pinning can be mounted directly inside any libp2p node.
- Refactored `startRelay()` to use the shared replication service internally, keeping the CLI-compatible relay runtime while exposing the service as a library feature.
- Added integration coverage for the direct libp2p-service mount path and for importing the package from a separate consumer project.
- Documented library usage in `README.md` and added `docs/libp2p-service.md`, which is now included in the published package.
- Added optional inbound Identify filtering for peers that do not advertise `/orbitdb/heads/*`, plus metrics and env docs for that behavior.

### Release note

This is a feature release that turns the relay’s OrbitDB replication logic into a reusable libp2p service. Consumers can now embed the replication and pinning behavior in their own libp2p nodes without giving up the existing CLI and `startRelay()` workflow.

## v0.6.4

- Updated `@chainsafe/libp2p-gossipsub` from `14.1.1` to `14.1.2`.
- Updated `@le-space/orbitdb-identity-provider-webauthn-did` from `^0.2.10` to `^0.2.13`.
- Aligned the dependency specifier in `pnpm-lock.yaml` with the package manifest.
- Verified the project with `npm test`; the full suite passed locally, including relay integration coverage.

### Release note

This is a low-risk patch release focused on dependency maintenance. The updated WebAuthn OrbitDB identity provider includes hybrid verification fixes for mixed varsig and default OrbitDB/WebAuthn verification paths, and gossipsub is aligned with the current package set used by the project.
