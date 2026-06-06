// The one async Signer interface. Everything that can sign — a local key, a
// browser extension (NIP-07), a remote bunker (NIP-46) — implements this, so
// publish/encrypt code is identical regardless of where the secret lives.
import type { EventTemplate, NostrEvent, Pubkey } from '@hopstr/core'

export type SignerBackend = 'local' | 'nip07' | 'nip46'

export interface Signer {
  /** Where the secret lives. Useful for UI and for choosing fallbacks. */
  readonly backend: SignerBackend

  /** The user's public key. Async because a bunker/extension may need a round-trip. */
  getPublicKey(): Promise<Pubkey>

  /**
   * Sign a template into a full, verified event. Returns the WHOLE event (not
   * just a signature) so callers never reassemble it — simpler than NDK's
   * sign-only contract.
   */
  signEvent(template: EventTemplate): Promise<NostrEvent>

  /** NIP-44 encrypt to a peer. The modern, mandatory path. */
  nip44Encrypt(peer: Pubkey, plaintext: string): Promise<string>
  /** NIP-44 decrypt from a peer. */
  nip44Decrypt(peer: Pubkey, ciphertext: string): Promise<string>

  /** NIP-04 decrypt — legacy READ ONLY (so old DMs stay readable). Optional. */
  nip04Decrypt?(peer: Pubkey, ciphertext: string): Promise<string>

  /**
   * Serialize enough to rebuild this signer in a later session, as a tagged
   * `{type, ...}` JSON string. NEVER returns a bare secret for remote signers.
   */
  toPayload(): string
}

/** Shape of a serialized signer payload (discriminated by `type`). */
export interface SignerPayload {
  type: SignerBackend
  [key: string]: unknown
}
