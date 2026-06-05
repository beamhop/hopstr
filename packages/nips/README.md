# @nostragent/nips

> Every NIP as a tree-shakeable subpath: a typed factory, a parser, and (where it applies) an action.

Import only the NIPs you use — `@nostragent/nips/nip23` pulls in just long-form articles. Each module turns the spec into plain, typed functions that build event templates (pass them to a [signer](../signers) or the [client](../client)) and parse events back into structured data.

## Install

```bash
bun add @nostragent/nips
```

## Highlights

### Private DMs — NIP-17 + NIP-59 gift wrap

```ts
import { sealDirectMessage, openDirectMessage } from '@nostragent/nips/nip17'

// one gift wrap per recipient PLUS one to yourself — metadata-private
const wraps = sealDirectMessage({ text: 'hey', to: [bobPubkey] }, mySecret)
for (const { recipient, wrap } of wraps) publishTo(recipient, wrap)

const message = openDirectMessage(giftWrap, mySecret)   // { from, to, text, at }
```

Gift wrap uses a fresh ephemeral key per wrap, back-dates timestamps (≤2 days, never future), and verifies the seal author on unwrap — all to the letter of NIP-59.

### Zaps — NIP-57

```ts
import { zapRequest, fetchZapInvoice, parseZapReceipt } from '@nostragent/nips/nip57'

const req = zapRequest({ recipient, amountMsat: 21_000, relays, lnurl, comment: 'great post' })
const signed = await signer.signEvent(req)
const { invoice } = await fetchZapInvoice('alice@wallet.com', signed, 21_000, lnurl)
// pay the bolt11 invoice; the receipt (kind 9735) is parseable with parseZapReceipt
```

### Lists — NIP-51

```ts
import { buildList, parseList, addBookmark, BOOKMARKS } from '@nostragent/nips/nip51'

let list = addBookmark({ public: [], private: [] }, eventId)         // public bookmark
list = addBookmark(list, secretId, true)                            // private (self-encrypted)
const event = buildList(BOOKMARKS, list, mySecret, myPubkey)
const back = parseList(event, mySecret, myPubkey)                   // { public, private }
```

Private items are NIP-44 self-encrypted into `content`; pass your key to `parseList` to decrypt them.

### Wallet Connect — NIP-47

```ts
import { parseConnectionUri, payInvoice, parseResponse } from '@nostragent/nips/nip47'
const conn = parseConnectionUri('nostr+walletconnect://...')
const request = payInvoice(conn, bolt11)            // encrypted kind-23194 to the wallet
```

## Every module

| Subpath | NIP | What |
| --- | --- | --- |
| `./nip02` | 02 | follow lists |
| `./nip09` | 09 | event deletion |
| `./nip10` | 10 | threaded replies (root/reply/mention markers) |
| `./nip18` | 18 | reposts + quote reposts |
| `./nip23` | 23 | long-form articles (+ drafts) |
| `./nip25` | 25 | reactions (incl. custom emoji) |
| `./nip27` | 27 | inline `nostr:` mentions → tags |
| `./nip47` | 47 | Nostr Wallet Connect |
| `./nip51` | 51 | lists & sets (public + private items) |
| `./nip57` | 57 | lightning zaps |
| `./nip59` | 59 | gift wrap |
| `./nip17` | 17 | private direct messages |
| `./nip98` | 98 | HTTP auth |

The long tail of NIPs lands in the next milestone, tracked by a coverage meta-test.

## License

MIT
