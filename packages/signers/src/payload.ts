// Rebuild a signer from a serialized payload (session persistence).
import type { Signer } from './signer.ts'
import { LocalSigner } from './local.ts'
import { Nip07Signer, type Nip07Provider } from './nip07.ts'
import { BunkerSigner, type BunkerOptions } from './nip46.ts'
import type { Pubkey } from '@nostragent/core'

export interface FromPayloadDeps {
  /** Provider for a restored NIP-07 signer (browser supplies window.nostr). */
  nip07Provider?: Nip07Provider
  /** Options to reconnect a NIP-46 bunker (transport + client secret). */
  bunker?: Pick<BunkerOptions, 'clientSecret' | 'transport' | 'timeout' | 'onAuthUrl' | 'genId'>
}

/**
 * Restore a signer from `signer.toPayload()`. Local signers restore fully;
 * nip07/nip46 need their live dependencies (provider / transport) supplied.
 * The returned bunker is NOT yet connected — call `.connect()`.
 */
export function fromPayload(payload: string, deps: FromPayloadDeps = {}): Signer {
  const parsed = JSON.parse(payload) as { type: string; [k: string]: unknown }
  switch (parsed.type) {
    case 'local':
      return new LocalSigner(parsed.secret as string)
    case 'nip07':
      return new Nip07Signer(deps.nip07Provider)
    case 'nip46': {
      if (!deps.bunker) throw new Error('restoring a nip46 signer needs bunker deps (transport + clientSecret)')
      return new BunkerSigner(
        {
          signerPubkey: parsed.signerPubkey as Pubkey,
          relays: parsed.relays as string[],
          ...(parsed.secret ? { secret: parsed.secret as string } : {}),
        },
        deps.bunker,
      )
    }
    default:
      throw new Error(`unknown signer payload type: ${parsed.type}`)
  }
}
