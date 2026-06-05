// Identity: a keypair with convenient hex/bech32 accessors. The facade's
// createIdentity/loadIdentity build on this.
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex, hexToBytes } from './primitives.ts'
import type { Pubkey } from './primitives.ts'
import { getPublicKey } from './serialize.ts'
import { decode, encodeNpub, encodeNsec } from './nip19.ts'

export interface Identity {
  /** 32-byte secret key. The whole identity — never log or transmit it. */
  readonly secretKey: Uint8Array
  /** x-only public key, hex. */
  readonly pubkey: Pubkey
  /** bech32 nsec (secret). */
  readonly nsec: string
  /** bech32 npub (shareable). */
  readonly npub: string
}

function fromSecret(secretKey: Uint8Array): Identity {
  const pubkey = getPublicKey(secretKey)
  return {
    secretKey,
    pubkey,
    nsec: encodeNsec(secretKey),
    npub: encodeNpub(pubkey),
  }
}

/** A brand-new random identity. */
export function createIdentity(): Identity {
  return fromSecret(schnorr.utils.randomSecretKey())
}

/** Load an identity from an nsec, hex secret, or raw 32-byte secret. */
export function loadIdentity(secret: string | Uint8Array): Identity {
  if (secret instanceof Uint8Array) {
    if (secret.length !== 32) throw new Error('secret key must be 32 bytes')
    return fromSecret(secret)
  }
  if (secret.startsWith('nsec1')) {
    const decoded = decode(secret)
    if (decoded.type !== 'nsec') throw new Error('expected an nsec')
    return fromSecret(decoded.data)
  }
  // hex
  if (!/^[0-9a-f]{64}$/i.test(secret)) throw new Error('expected nsec, 64-char hex, or 32 bytes')
  return fromSecret(hexToBytes(secret.toLowerCase()))
}

/** Just the npub for a pubkey (re-export convenience). */
export const npubOf = (pubkey: string): string => encodeNpub(pubkey)
/** Pull the bytes out so callers can pass to signers without exposing structure. */
export const secretHex = (id: Identity): string => bytesToHex(id.secretKey)
