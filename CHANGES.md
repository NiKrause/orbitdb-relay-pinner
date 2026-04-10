# Changes

## v0.6.4

- Updated `@chainsafe/libp2p-gossipsub` from `14.1.1` to `14.1.2`.
- Updated `@le-space/orbitdb-identity-provider-webauthn-did` from `^0.2.10` to `^0.2.13`.
- Aligned the dependency specifier in `pnpm-lock.yaml` with the package manifest.
- Verified the project with `npm test`; the full suite passed locally, including relay integration coverage.

### Release note

This is a low-risk patch release focused on dependency maintenance. The updated WebAuthn OrbitDB identity provider includes hybrid verification fixes for mixed varsig and default OrbitDB/WebAuthn verification paths, and gossipsub is aligned with the current package set used by the project.
