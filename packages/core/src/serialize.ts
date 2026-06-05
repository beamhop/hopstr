// NIP-01 event id computation and schnorr signing/verification.
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import type { EventTemplate, NostrEvent, UnsignedEvent } from './event.ts'
import {
  bytesToHex,
  hexToBytes,
  parseEventId,
  parsePubkey,
  parseSignature,
  toSecretBytes,
  utf8ToBytes,
} from './primitives.ts'
import type { EventId, Pubkey, Signature } from './primitives.ts'

/**
 * The canonical NIP-01 serialization: a JSON array `[0, pubkey, created_at,
 * kind, tags, content]` with no extra whitespace.
 *
 * `JSON.stringify` is exactly correct here: it escapes `"`, `\`, and the C0
 * control chars (`\b \t \n \f \r` named, others as `\uXXXX`) and emits every
 * other character — including all multibyte UTF-8 — verbatim, which is what
 * NIP-01 mandates. We do NOT normalize Unicode.
 */
export function serializeEvent(event: {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content])
}

/** The event id is the lowercase hex SHA256 of the canonical serialization. */
export function getEventHash(event: {
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
}): EventId {
  return bytesToHex(sha256(utf8ToBytes(serializeEvent(event)))) as EventId
}

/** The 32-byte x-only public key (hex) for a secret key (hex or bytes). */
export function getPublicKey(secret: Uint8Array | string): Pubkey {
  return bytesToHex(schnorr.getPublicKey(toSecretBytes(secret))) as Pubkey
}

/**
 * Turn a template + secret key into a fully signed event. Fills `created_at`
 * (now, in seconds) and `pubkey` if absent, computes the id, and Schnorr-signs
 * it. Returns a `NostrEvent` — the only way to mint one.
 */
export function finalizeEvent(template: EventTemplate, secret: Uint8Array | string): NostrEvent {
  const sk = toSecretBytes(secret)
  const pubkey = getPublicKey(sk)
  const created_at = template.created_at ?? Math.floor(Date.now() / 1000)
  const base = { pubkey, created_at, kind: template.kind, tags: template.tags, content: template.content }
  const id = getEventHash(base)
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk)) as Signature
  return { ...base, id, sig }
}

/** Recompute the id from the unsigned fields; true if it matches event.id. */
export function hasValidId(event: UnsignedEvent | NostrEvent): boolean {
  return getEventHash(event) === event.id
}

/**
 * Verify an event end to end: the id must hash-match the content AND the
 * signature must verify against the pubkey. A type guard so callers narrow to
 * `NostrEvent`.
 */
export function verifyEvent(event: NostrEvent): boolean {
  if (typeof event.sig !== 'string' || typeof event.id !== 'string') return false
  if (!hasValidId(event)) return false
  try {
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
  } catch {
    return false
  }
}

/** Validate-and-brand the four hex fields of an event read off the wire. */
export function brandEventFields(event: NostrEvent): NostrEvent {
  return {
    ...event,
    id: parseEventId(event.id),
    pubkey: parsePubkey(event.pubkey),
    sig: parseSignature(event.sig),
  }
}
