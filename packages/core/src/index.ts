// @nostragent/core — Velvet's pure Nostr kernel.
// The drop-in facade (NostrClient, DEFAULT_RELAYS, runAgent) is grafted on in
// Phase 7 once @nostragent/client exists.

export type {
  Tag,
  EventTemplate,
  UnsignedEvent,
  NostrEvent,
  VerifiedEvent,
  KindClass,
} from './event.ts'
export {
  classifyKind,
  isReplaceable,
  isEphemeral,
  isAddressable,
  isParameterizedReplaceable,
  addressOf,
} from './event.ts'

export type { Pubkey, SecretKeyHex, EventId, Signature, Branded } from './primitives.ts'
export {
  bytesToHex,
  hexToBytes,
  bytesToUtf8,
  utf8ToBytes,
  concatBytes,
  randomBytes,
  isHex64,
  parsePubkey,
  parseEventId,
  parseSignature,
  parseSecretKeyHex,
  toSecretBytes,
} from './primitives.ts'

export {
  serializeEvent,
  getEventHash,
  getPublicKey,
  finalizeEvent,
  hasValidId,
  verifyEvent,
  brandEventFields,
} from './serialize.ts'

export { TemplateBuilder, build, buildNote } from './builder.ts'

export type { Filter } from './filter.ts'
export { matchFilter, matchFilters } from './filter.ts'

export { countLeadingZeroBits, mine } from './nip13.ts'

export type { Identity } from './identity.ts'
export { createIdentity, loadIdentity, npubOf, secretHex } from './identity.ts'

// NIP-19 / NIP-21 / NIP-44 are also available as focused subpath imports
// (@nostragent/core/nip19 etc.) for tree-shaking; re-exported here for convenience.
export * as nip19 from './nip19.ts'
export * as nip21 from './nip21.ts'
export * as nip44 from './nip44.ts'
