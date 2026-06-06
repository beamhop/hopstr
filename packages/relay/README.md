# @hopstr/relay

> One resilient WebSocket connection to one Nostr relay.

A single-relay client with a small, sturdy state machine: it reconnects with exponential backoff, replays your subscriptions after a drop, tracks publish acknowledgements, handles NIP-42 auth, and parses the wire protocol into typed messages. The WebSocket and the clock are injectable, so all of this is deterministically testable.

Most apps use [`@hopstr/pool`](../pool) (many relays) or [`@hopstr/client`](../client) on top of this — but `Relay` is here when you want to talk to exactly one.

## Install

```bash
bun add @hopstr/relay
```

## Use

```ts
import { Relay } from '@hopstr/relay'

const relay = new Relay('wss://relay.damus.io')   // uses the global WebSocket
await relay.connect()

const unsub = relay.subscribe([{ kinds: [1], limit: 20 }], {
  onEvent: (event) => console.log(event.content),
  onEose: () => console.log('caught up'),
})

const result = await relay.publish(signedEvent)   // { ok, reason } — never throws
unsub()
relay.close()
```

### Resilience & auth

- **Reconnection** with exponential backoff (`minBackoff`→`maxBackoff`); subscriptions are replayed and queued messages flushed on reconnect.
- **NIP-42**: pass an `auth(challenge)` callback; the relay answers `AUTH` and `auth-required:` rejections automatically (build the event with `buildAuthTemplate`).
- **Typed messages**: `parseRelayMessage` / `reasonPrefix` expose `OK`/`CLOSED`/`NOTICE`/`EOSE`/`AUTH`/`COUNT` and the standardized reason prefixes.

### Injection (for tests & non-browser runtimes)

```ts
new Relay(url, {
  WebSocket: myFactory,     // any (url) => WebSocketLike
  now, setTimer, clearTimer, // deterministic clock for backoff/timeout tests
  auth, minBackoff, maxBackoff, publishTimeout,
})
```

## NIP-11 relay info

```ts
import { fetchRelayInformation, supportsNip, clampLimit } from '@hopstr/relay'

const info = await fetchRelayInformation('wss://relay.damus.io')
supportsNip(info, 42)          // boolean
clampLimit(info, 1000)         // honors the relay's max_limit
```

## License

MIT
