// NIP-07: wrap a browser extension's `window.nostr`. The provider is injectable
// so it's testable and SSR-safe; in a browser, omit it and we read window.nostr.
import { brandEventFields, parsePubkey, type EventTemplate, type NostrEvent, type Pubkey } from '@nostragent/core'
import type { Signer } from './signer.ts'

/** The shape a NIP-07 extension exposes on `window.nostr`. */
export interface Nip07Provider {
  getPublicKey(): Promise<string>
  signEvent(event: EventTemplate & { pubkey?: string }): Promise<NostrEvent>
  nip44?: { encrypt(peer: string, plaintext: string): Promise<string>; decrypt(peer: string, ciphertext: string): Promise<string> }
  nip04?: { encrypt(peer: string, plaintext: string): Promise<string>; decrypt(peer: string, ciphertext: string): Promise<string> }
}

/** Swallow a settled promise's value/error (used to advance the call queue). */
function ignore(): void {}

function resolveProvider(provided?: Nip07Provider): Nip07Provider {
  if (provided) return provided
  const w = (globalThis as { nostr?: Nip07Provider }).nostr
  if (!w) throw new Error('no NIP-07 provider found (window.nostr is undefined)')
  return w
}

export class Nip07Signer implements Signer {
  readonly backend = 'nip07' as const
  #provider: Nip07Provider
  // Extensions serialize poorly under concurrent encryption calls; chain them.
  #queue: Promise<unknown> = Promise.resolve()

  constructor(provider?: Nip07Provider) {
    this.#provider = resolveProvider(provider)
  }

  #serialize<T>(task: () => Promise<T>): Promise<T> {
    // Run `task` once the queue is idle, whether the previous call resolved or
    // rejected (an earlier failure must not wedge later calls). `ignore` swallows
    // a prior outcome; `run` is the caller's real result.
    const run = this.#queue.catch(ignore).then(task)
    this.#queue = run.catch(ignore)
    return run
  }

  async getPublicKey(): Promise<Pubkey> {
    return parsePubkey(await this.#provider.getPublicKey())
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    const signed = await this.#provider.signEvent(template)
    return brandEventFields(signed)
  }

  async nip44Encrypt(peer: Pubkey, plaintext: string): Promise<string> {
    if (!this.#provider.nip44) throw new Error('extension does not support nip44')
    return this.#serialize(() => this.#provider.nip44!.encrypt(peer, plaintext))
  }

  async nip44Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    if (!this.#provider.nip44) throw new Error('extension does not support nip44')
    return this.#serialize(() => this.#provider.nip44!.decrypt(peer, ciphertext))
  }

  async nip04Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    if (!this.#provider.nip04) throw new Error('extension does not support nip04')
    return this.#serialize(() => this.#provider.nip04!.decrypt(peer, ciphertext))
  }

  /** A NIP-07 signer can't be serialized to a secret; record the backend only. */
  toPayload(): string {
    return JSON.stringify({ type: 'nip07' })
  }
}

/** Convenience: `nip07Signer()` in a browser, or `nip07Signer(mockProvider)` in tests. */
export function nip07Signer(provider?: Nip07Provider): Nip07Signer {
  return new Nip07Signer(provider)
}
