# @hopstr/router

> The outbox/gossip model (NIP-65): pick which relays to read from and write to.

To find someone's notes you read their **write** relays; to reach someone you write to their **read** relays. The router turns a set of pubkeys + an intent into a small, well-chosen relay set, using each author's advertised NIP-65 relay list. A greedy, log-dampened, quality-weighted set-cover keeps the selection small and spreads load instead of dumping everyone on one mega-relay.

Policy (where relay lists come from, defaults, quality, caps) is injected, so the router itself is pure and fully testable.

## Install

```bash
bun add @hopstr/router
```

## Use

```ts
import { Router } from '@hopstr/router'

const router = new Router({
  getPubkeyRelays: (pubkey, use) => relayListFor(pubkey, use),  // 'read' | 'write'
  getDefaultRelays: () => ['wss://relay.damus.io', 'wss://nos.lol'],
  getRelayQuality: (url) => quality[url] ?? 1,   // optional 0..1 weight
  getLimit: () => 4,                              // optional cap per selection
})

// Relays to READ a set of authors (their write/outbox relays):
router.forPubkeys([alice, bob])
// → [{ relay: 'wss://shared', pubkeys: [alice, bob] }, ...]

// Relays to deliver TO recipients (their read/inbox relays):
router.toPubkeys([carol])

// Where to publish an event: author's write relays + every mentioned p-tag's
// read relays, so mentions land in the right inboxes.
router.publishEvent(authorPubkey, mentionedPubkeys)   // → ['wss://...', ...]
```

## NIP-65 + relay hints

```ts
import { parseRelayList, readRelays, writeRelays } from '@hopstr/router'
const entries = parseRelayList(kind10002Event)
writeRelays(entries)   // outbox
readRelays(entries)    // inbox

import { hintsFromTags, hintsFromPointer } from '@hopstr/router'
hintsFromTags(event)              // relay hints in e/a/p tags
hintsFromPointer('nevent1...')    // relays embedded in a NIP-19 pointer
```

## License

MIT
