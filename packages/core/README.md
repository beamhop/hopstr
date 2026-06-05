# @nostragent/core

> Velvet's pure Nostr kernel — zero network, runs anywhere.

The audited-grade foundation every other Velvet package builds on: the event model, NIP-01 ids, schnorr signing/verification, the kind classifier, filters, proof-of-work, and the NIP-19 / NIP-21 / NIP-44 codecs. No websockets, no Node built-ins — `@noble/*` and `@scure/*` only, so it runs identically in the browser, Bun, Node, Deno, and workers.

Every cryptographic path is verified against the **official test vectors** (NIP-44, BIP-340, including the `invalid.*` error cases), and the package ships at **100% test coverage**.

## Install

```bash
bun add @nostragent/core
```

## Identities & events

```ts
import { createIdentity, loadIdentity, buildNote, finalizeEvent, verifyEvent } from '@nostragent/core'

const me = createIdentity()              // { secretKey, pubkey, nsec, npub }
const same = loadIdentity(me.nsec)       // from nsec, hex, or raw bytes

const template = buildNote('gm')         // fluent builder
  .tag('t', 'coffee')
  .mention(same.pubkey)

const event = finalizeEvent(template, me.secretKey)   // signed NostrEvent
verifyEvent(event)                       // true
```

### Branded types make illegal states unrepresentable

`Pubkey`, `EventId`, and `Signature` are branded strings: a raw string can't masquerade as a validated id, and you can't publish an unsigned event — the type system stops you. Encoders accept plain strings and validate internally; decoders return branded values you can trust.

## NIP-19 entities — `@nostragent/core/nip19`

```ts
import { encodeNpub, decode, encodeNaddr } from '@nostragent/core/nip19'

encodeNpub(me.pubkey)                    // "npub1..."
decode('npub1...')                       // { type: 'npub', data: Pubkey }
encodeNaddr({ identifier: 'my-post', pubkey: me.pubkey, kind: 30023 })  // "naddr1..."
```

All seven entities round-trip: `npub`, `nsec`, `note`, `nprofile`, `nevent`, `naddr` (with TLV: relays, author, big-endian kind), respecting the 5000-char limit.

## NIP-44 v2 encryption — `@nostragent/core/nip44`

```ts
import { encryptTo, decryptFrom, getConversationKey } from '@nostragent/core/nip44'

const ciphertext = encryptTo('secret', me.secretKey, peerPubkey)
const plaintext = decryptFrom(ciphertext, me.secretKey, peerPubkey)
```

ECDH → HKDF → ChaCha20 + HMAC-SHA256 with versioned padding, byte-for-byte matching the official vectors.

## Also exported from `.`

- `serializeEvent`, `getEventHash`, `getPublicKey`, `finalizeEvent`, `hasValidId`, `verifyEvent`
- `build`, `buildNote`, `TemplateBuilder`
- `classifyKind`, `isReplaceable`, `isEphemeral`, `isAddressable`, `addressOf`
- `matchFilter`, `matchFilters` (NIP-01 filter semantics, for local matching)
- `mine`, `countLeadingZeroBits` (NIP-13 proof of work)
- byte/hex/utf8 helpers and the `parse*` smart constructors
- `nip19`, `nip21`, `nip44` namespaces (also available as subpath imports)

## License

MIT
