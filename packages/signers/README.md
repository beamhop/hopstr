# @hopstr/signers

> One async `Signer` interface. Local key, browser extension, or remote bunker — the same `publish()` code works with all three.

The single biggest ergonomics lever in a Nostr library: every backend implements **one** interface, and every method is async, so your call sites never branch on where the key lives.

```ts
interface Signer {
  readonly backend: 'local' | 'nip07' | 'nip46'
  getPublicKey(): Promise<Pubkey>
  signEvent(template: EventTemplate): Promise<NostrEvent>   // returns the WHOLE signed event
  nip44Encrypt(peer: Pubkey, plaintext: string): Promise<string>
  nip44Decrypt(peer: Pubkey, ciphertext: string): Promise<string>
  nip04Decrypt?(peer: Pubkey, ciphertext: string): Promise<string>  // legacy read-only
  toPayload(): string                                       // session persistence
}
```

## Install

```bash
bun add @hopstr/signers
```

## Backends

### Local key

```ts
import { privateKeySigner } from '@hopstr/signers'

const signer = privateKeySigner(nsecOrHexOrBytes)
const event = await signer.signEvent({ kind: 1, tags: [], content: 'gm' })
```

### NIP-07 browser extension

```ts
import { nip07Signer } from '@hopstr/signers'

const signer = nip07Signer()        // wraps window.nostr (pass a provider in tests)
```

Encryption calls are serialized into a queue (extensions misbehave under concurrency), and a failed call never wedges later ones.

### NIP-46 remote bunker

```ts
import { bunkerSigner } from '@hopstr/signers'

const signer = await bunkerSigner('bunker://<pubkey>?relay=wss://relay&secret=...', {
  clientSecret,            // a disposable local key
  transport,               // publish + subscribe over relays (wired by @hopstr/client)
  onAuthUrl: (url) => open(url),   // surfaced when the signer needs user approval
})
const pubkey = await signer.getPublicKey()
```

Speaks the NIP-46 JSON-RPC (kind 24133, NIP-44 encrypted): `connect`, `get_public_key`, `sign_event`, `ping`, `nip44_encrypt/decrypt`, `nip04_decrypt`, with `auth_url` challenges and per-request timeouts.

## Key utilities

```ts
import {
  generateSeedWords, privateKeyHexFromSeedWords,   // NIP-06 (m/44'/1237'/account'/0/0)
  encryptKey, decryptKey,                           // NIP-49 ncryptsec (scrypt + XChaCha20-Poly1305)
  fromPayload,                                       // rebuild any signer from toPayload()
} from '@hopstr/signers'

const ncryptsec = encryptKey(secret, password)       // "ncryptsec1..."
const secret = decryptKey(ncryptsec, password)
```

NIP-49 is verified against the official test vector; NIP-06 against the reference mnemonic vector.

## License

MIT
