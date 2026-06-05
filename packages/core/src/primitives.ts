// Low-level byte/hex/utf8 helpers and branded id types.
// We lean on @noble/hashes utils so the package stays isomorphic (no Buffer, no node:crypto).
import { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes } from '@noble/hashes/utils.js'

export { bytesToHex, hexToBytes, concatBytes, utf8ToBytes, randomBytes }

const decoder = /* @__PURE__ */ new TextDecoder()
export function bytesToUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes)
}

/**
 * Branded strings. A `Pubkey` is a 32-byte lowercase hex string that has been
 * validated; a raw `string` cannot masquerade as one without going through a
 * smart constructor. This makes whole classes of bug (bech32 in a filter, an
 * unsigned id) unrepresentable.
 */
declare const brand: unique symbol
export type Branded<T, B extends string> = T & { readonly [brand]: B }

export type Pubkey = Branded<string, 'Pubkey'>
export type SecretKeyHex = Branded<string, 'SecretKeyHex'>
export type EventId = Branded<string, 'EventId'>
export type Signature = Branded<string, 'Signature'>

const HEX64 = /^[0-9a-f]{64}$/
const HEX128 = /^[0-9a-f]{128}$/

export function isHex64(value: string): boolean {
  return HEX64.test(value)
}

/** Lowercase + validate a 64-char hex string, throwing with a useful message. */
function assertHex64(value: string, label: string): string {
  const lower = value.toLowerCase()
  if (!HEX64.test(lower)) {
    throw new TypeError(`invalid ${label}: expected 64 hex chars, got ${JSON.stringify(value)}`)
  }
  return lower
}

export function parsePubkey(value: string): Pubkey {
  return assertHex64(value, 'pubkey') as Pubkey
}

export function parseEventId(value: string): EventId {
  return assertHex64(value, 'event id') as EventId
}

export function parseSignature(value: string): Signature {
  const lower = value.toLowerCase()
  if (!HEX128.test(lower)) {
    throw new TypeError(`invalid signature: expected 128 hex chars, got ${value.length} chars`)
  }
  return lower as Signature
}

/** Coerce a secret key given as hex string, nsec is handled in nip19. */
export function parseSecretKeyHex(value: string): SecretKeyHex {
  return assertHex64(value, 'secret key') as SecretKeyHex
}

/** secret keys flow as bytes internally; this normalizes hex|bytes → bytes. */
export function toSecretBytes(secret: Uint8Array | string): Uint8Array {
  if (typeof secret === 'string') return hexToBytes(parseSecretKeyHex(secret))
  if (secret.length !== 32) throw new TypeError(`secret key must be 32 bytes, got ${secret.length}`)
  return secret
}
