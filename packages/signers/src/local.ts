// The local private-key signer. Holds the secret in memory and implements the
// full Signer interface synchronously under the hood (but async on the surface,
// so call sites match remote signers exactly).
import {
  bytesToHex,
  finalizeEvent,
  getPublicKey,
  loadIdentity,
  nip44,
  toSecretBytes,
  type EventTemplate,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'
import type { Signer } from './signer.ts'
import { nip04Decrypt } from './nip04.ts'

export class LocalSigner implements Signer {
  readonly backend = 'local' as const
  #secret: Uint8Array

  constructor(secret: Uint8Array | string) {
    // Accept nsec / hex / bytes via the core loader (which validates).
    this.#secret = loadIdentity(secret).secretKey
  }

  async getPublicKey(): Promise<Pubkey> {
    return getPublicKey(this.#secret)
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    return finalizeEvent(template, this.#secret)
  }

  async nip44Encrypt(peer: Pubkey, plaintext: string): Promise<string> {
    return nip44.encryptTo(plaintext, this.#secret, peer)
  }

  async nip44Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    return nip44.decryptFrom(ciphertext, this.#secret, peer)
  }

  async nip04Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    return nip04Decrypt(this.#secret, peer, ciphertext)
  }

  /** Serializes the raw secret — only safe because the key is already local. */
  toPayload(): string {
    return JSON.stringify({ type: 'local', secret: bytesToHexLocal(this.#secret) })
  }
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/** Convenience constructor: `privateKeySigner(nsecOrHexOrBytes)`. */
export function privateKeySigner(secret: Uint8Array | string): LocalSigner {
  // touch toSecretBytes so an invalid raw-bytes length fails fast here too
  if (secret instanceof Uint8Array) toSecretBytes(secret)
  return new LocalSigner(secret)
}
