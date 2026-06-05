# @nostragent/core

> Velvet's pure Nostr kernel — zero network, runs anywhere.

The audited-grade foundation every other Velvet package builds on: the event model, NIP-01 ids, schnorr signing/verification, the kind classifier, filters, and the NIP-19 / NIP-21 / NIP-44 codecs. No websockets, no Node built-ins — `@noble/*` and `@scure/*` only, so it runs identically in the browser, Bun, Node, Deno, and workers.

It also re-exports the high-level **drop-in facade** (`createIdentity`, `loadIdentity`, `NostrClient`, `DEFAULT_RELAYS`) so `import … from '@nostragent/core'` keeps working for the `nostr-agent` CLI.

## Install

```bash
bun add @nostragent/core
```

## Use

```ts
import { buildNote, getEventId, verifyEvent } from '@nostragent/core'
import { encodeNpub, decodeNpub } from '@nostragent/core/nip19'
import { encrypt, decrypt } from '@nostragent/core/nip44'

const template = buildNote('gm').tag('t', 'coffee')
```

> Full API lands in Phase 1 of the build. This README will grow with it.

## Exports

| Subpath | Contents |
| --- | --- |
| `.` | event model, ids, schnorr, filters, kind classifier, facade |
| `./nip19` | bech32 entities (`npub`, `nsec`, `note`, `nprofile`, `nevent`, `naddr`, `nrelay`) |
| `./nip21` | `nostr:` URIs |
| `./nip44` | NIP-44 v2 encryption primitive |

## License

MIT
