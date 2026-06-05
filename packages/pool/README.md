# @nostragent/pool

> Query and subscribe across many relays — with dedup, per-relay EOSE, and async-iterable subscriptions.

The pool lazily opens one connection per relay URL, fans a filter out to all of them, deduplicates events by id, and aggregates EOSE so you get one clean "caught up" signal. Subscriptions are **`AsyncIterable`** — loop with `for await`, and `break` (or an `AbortSignal`) closes them. No subscription-id bookkeeping, ever.

## Install

```bash
bun add @nostragent/pool
```

## Use

```ts
import { Pool } from '@nostragent/pool'

const pool = new Pool()
const relays = ['wss://relay.damus.io', 'wss://nos.lol']

// live, reactive — a plain loop. `break` closes the subscription.
for await (const note of pool.subscribe(relays, [{ kinds: [1], limit: 50 }])) {
  console.log(note.content)
  if (note.content.includes('stop')) break
}

// one-shot collectors
const recent = await pool.query(relays, { kinds: [1], authors: [pubkey] })   // dedup'd, to EOSE
const profile = await pool.queryOne(relays, { kinds: [0], authors: [pubkey] }) // newest single

// publish to many relays — per-relay results, never throws on partial failure
const results = await pool.publish(relays, signedEvent)
// [{ relay, ok: true, reason: '' }, { relay, ok: false, reason: 'blocked: ...' }]
```

### The Subscription

`pool.subscribe(...)` returns a `Subscription` that is **both** an `AsyncIterable<NostrEvent>` and has:

- `.all()` — collect until EOSE, then auto-close
- `.first()` — the first event (or `null`)
- `.take(n)` — the first `n`, then close
- `.on('event' | 'eose' | 'close', cb)` — callback style
- `.close()` — tear down (also via `break` or `{ signal }`)

Events are **verified** (id + signature) by default before delivery; pass `{ verify: false }` to skip.

## License

MIT
