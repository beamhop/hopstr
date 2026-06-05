# @nostragent/store

> A reactive in-memory event store that does the bookkeeping every Nostr client needs.

`add()` an event and the store applies the standard rules automatically: dedup by id, "newest wins" for replaceable (kind 0/3/10000–19999) and addressable (30000–39999) events, NIP-09 deletions, and NIP-40 expiry. Subscribers get a live stream of accepted events.

## Install

```bash
bun add @nostragent/store
```

## Use

```ts
import { EventStore } from '@nostragent/store'

const store = new EventStore()

store.add(event)              // → 'added' | 'duplicate' | 'replaced' | 'outdated' | 'deleted' | 'expired'

store.get(id)                 // one event (undefined if missing or expired)
store.getReplaceable('0:' + pubkey + ':')   // newest for a kind:pubkey:d coordinate
store.query([{ kinds: [1], authors: [pubkey] }])   // matches, newest first
store.size                    // count

// reactive
const off = store.onEvent((e) => render(e))

// live AsyncIterable: replays current matches, then streams new ones
for await (const e of store.stream([{ kinds: [1] }], signal)) {
  console.log(e.content)
}
```

### What `add()` handles for you

- **Dedup** — the same id is never stored twice.
- **Replaceable / addressable** — only the newest per `kind:pubkey[:d]` is kept; ties break on the lexically-lower id (NIP-01).
- **NIP-09 deletion** — a kind-5 event removes the events/addresses it references *by the same author*, and tombstones their ids so they can't be re-added.
- **NIP-40 expiry** — events past their `expiration` tag are rejected on add and dropped on read.

### Pluggable backend

The default is in-memory. Implement the tiny `StoreBackend` interface (`get`/`set`/`delete`/`values`) to back it with SQLite, IndexedDB, etc.

## License

MIT
