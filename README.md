# Velvet

> The Nostr toolkit that feels like velvet: **every NIP, zero ceremony, runs anywhere TypeScript does.**

Velvet is a world-class, fully NIP-complete, maximally ergonomic [Nostr](https://nostr.com) client library for TypeScript. It runs unchanged in the browser, Bun, Node, Deno, and workers.

```ts
import { Nostr } from '@nostragent/client'

const nostr = await Nostr.create()        // random key, sane relays, outbox routing on
await nostr.note('hello nostr')           // signs + routes to your write relays

for await (const note of nostr.notes({ kinds: [1], limit: 20 })) {
  console.log(note.content)               // a plain for-await loop — no RxJS, no sub-id bookkeeping
}
```

## Packages

| Package | What it owns |
| --- | --- |
| [`@nostragent/core`](packages/core) | Pure event model, NIP-01 id/serialization, schnorr, NIP-19/21/44, **+ the drop-in facade** |
| [`@nostragent/signers`](packages/signers) | One async `Signer` interface — local key, NIP-07, NIP-46 bunker, NIP-49, NIP-06 |
| [`@nostragent/relay`](packages/relay) | Single-socket FSM, reconnection, NIP-11/42, typed wire messages |
| [`@nostragent/pool`](packages/pool) | Multi-relay pool: filter splitting, dedup, per-relay EOSE, NIP-77 sync |
| [`@nostragent/router`](packages/router) | Outbox/gossip routing (NIP-65) as a weighted scenario model |
| [`@nostragent/store`](packages/store) | Reactive in-memory event store: dedupe, replaceable, NIP-09/40 |
| [`@nostragent/nips`](packages/nips) | Every NIP as a tree-shakeable subpath: typed factory + parser + action |
| [`@nostragent/client`](packages/client) | The high-level reactive client wiring everything together |

## Design

Five load-bearing decisions make Velvet ergonomic:

1. **One async `Signer`** — the same `publish()` code works with a local key, a browser extension, or a remote bunker.
2. **Subscriptions are `AsyncIterable`** — `for await` over events; `break` closes the subscription. One method, not five.
3. **`publish()` returns per-relay results and never throws** on partial failure (`.orThrow()` if you want it to).
4. **Branded event types** — you physically cannot publish an unsigned event; the type system catches it.
5. **Outbox routing on by default**, overridable per call with `.to(relays)`.

## Develop

```bash
bun install
bun test --coverage     # unit tests + 100% coverage gate
bun run typecheck
bun run build           # tsdown → ESM + .d.ts for every package
E2E=1 bun test tests/e2e   # end-to-end against local relays (needs Docker)
```

## License

MIT
