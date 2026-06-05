// NIP-21 nostr: URIs — a thin wrapper over NIP-19 entities.
import { decode, type DecodedEntity } from './nip19.ts'

const SCHEME = 'nostr:'

/** `nostr:npub1...` → the bare entity string. Accepts with or without scheme. */
export function toEntity(uri: string): string {
  return uri.startsWith(SCHEME) ? uri.slice(SCHEME.length) : uri
}

/** Wrap a NIP-19 entity in a `nostr:` URI (idempotent). */
export function toUri(entity: string): string {
  return entity.startsWith(SCHEME) ? entity : SCHEME + entity
}

/** Decode a `nostr:` URI to its tagged NIP-19 entity. nsec is rejected (never a URI). */
export function decodeUri(uri: string): Exclude<DecodedEntity, { type: 'nsec' }> {
  const decoded = decode(toEntity(uri))
  if (decoded.type === 'nsec') throw new Error('nsec is not a valid nostr: URI')
  return decoded
}
