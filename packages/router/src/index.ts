// @hopstr/router — the NIP-65 outbox/gossip model.
export { Router, type RouterPolicy, type Selection } from './router.ts'
export {
  parseRelayList,
  normalizeRelayUrl,
  readRelays,
  writeRelays,
  type RelayListEntry,
} from './nip65.ts'
export { hintsFromTags, hintsFromPointer } from './hints.ts'
