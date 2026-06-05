// @nostragent/client — the high-level reactive Nostr client.
export { Nostr, DEFAULT_RELAYS, type NostrOptions } from './client.ts'
export { PublishThunk, type PublishDriver } from './publish.ts'
export { storeBackedPolicy } from './policy.ts'

// Re-export the pieces most apps reach for, so `@nostragent/client` is a
// one-stop import for the common case.
export type { Signer } from '@nostragent/signers'
export type { Subscription, PoolPublishResult } from '@nostragent/pool'
export type { Filter, NostrEvent, EventTemplate, Pubkey } from '@nostragent/core'
