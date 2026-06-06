---
"@hopstr/core": minor
"@hopstr/signers": minor
"@hopstr/relay": minor
"@hopstr/pool": minor
"@hopstr/router": minor
"@hopstr/store": minor
"@hopstr/nips": minor
"@hopstr/client": minor
"@hopstr/agent": minor
---

Initial public release of Velvet — a world-class, NIP-complete, maximally ergonomic Nostr client library.

- **core** — pure event model, NIP-01 ids, schnorr, NIP-13/19/21/44 (vector-verified crypto)
- **signers** — one async Signer over local key / NIP-07 / NIP-46 / NIP-49 / NIP-06
- **relay + pool** — resilient connections, outbox-ready multi-relay queries, async-iterable subscriptions
- **router + store** — NIP-65 outbox routing and a reactive event store
- **nips** — every NIP as a tree-shakeable subpath, with an all-NIP coverage meta-test
- **client** — the high-level `Nostr.create()` API with optimistic publish
- **agent** — the drop-in `NostrClient` facade (NIP-17 DMs) + the autonomous `runAgent` loop
