# @hopstr/client

> The high-level reactive Nostr client. Two lines to hello-world; the deep foundation is right there when you need it.

`@hopstr/client` wires the whole Velvet stack — [core](../core), [signers](../signers), [pool](../pool), [router](../router), [store](../store) — into one configured-once object. Outbox/NIP-65 routing is on by default; every call can override it.

## Install

```bash
bun add @hopstr/client
```

## Hello, Nostr

```ts
import { Nostr } from '@hopstr/client'

const nostr = await Nostr.create()        // random key, sane relays, outbox on
await nostr.note('hello nostr')           // signs + routes to your write relays
```

## Read, reactively

```ts
// a plain for-await loop — no RxJS, no subscription-id bookkeeping. break closes it.
for await (const note of nostr.notes({ authors: [alice] })) {
  console.log(note.content)
  if (note.content.includes('stop')) break
}

const recent  = await nostr.notes({ kinds: [1], limit: 20 }).take(20)
const profile = await nostr.profile(alice)        // kind-0, parsed, cached
const one     = await nostr.queryOne({ kinds: [0], authors: [alice] })
```

## Publish, optimistically and honestly

```ts
const pub = nostr.note('gm')               // a PromiseLike "thunk"
const event = await pub.event()            // the signed event, already in the local store
pub.undo()                                 // soft-undo before it hits the network

const results = await nostr.note('gm')     // PoolPublishResult[] — per relay, never throws
if (results.some(r => r.ok)) ok()          // partial success is normal

await nostr.note('gm').to(['wss://my.relay']).timeout(8_000)   // chained options
await nostr.note('gm').orThrow()           // throw only if EVERY relay rejected
```

## Configure

```ts
await Nostr.create({
  secretKey: nsecOrHexOrBytes,   // or `signer` (local / NIP-07 / NIP-46), or neither (random)
  relays: ['wss://relay.damus.io', 'wss://nos.lol'],
  outbox: true,                  // NIP-65 routing on (default). false = just use `relays`
  readOnly: true,                // no signer; reading works, signing throws
})
```

When `outbox` is on, reads go to followed authors' write relays and publishes go to your write relays plus any mentioned user's inbox — driven by the [router](../router) from NIP-65 relay lists it learns from the [store](../store).

## What you also get

`nostr.pool`, `nostr.store`, and `nostr.router` are exposed for direct access, and the package re-exports the common `Signer`, `Subscription`, `Filter`, `NostrEvent`, `EventTemplate`, and `Pubkey` types so it's a one-stop import.

## License

MIT
