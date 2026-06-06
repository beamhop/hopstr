// A RouterPolicy backed by the EventStore: relay lists come from kind-10002
// events we've stored, falling back to the configured default relays.
import type { Pubkey } from '@hopstr/core'
import type { EventStore } from '@hopstr/store'
import { parseRelayList, readRelays, writeRelays, type RouterPolicy } from '@hopstr/router'

export function storeBackedPolicy(store: EventStore, defaults: string[], limit = 4): RouterPolicy {
  return {
    getPubkeyRelays(pubkey: Pubkey, use: 'read' | 'write'): string[] {
      const list = store.getReplaceable(`10002:${pubkey}:`)
      if (!list) return []
      const entries = parseRelayList(list)
      return use === 'read' ? readRelays(entries) : writeRelays(entries)
    },
    getDefaultRelays: () => defaults,
    getLimit: () => limit,
  }
}
