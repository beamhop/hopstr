// The outbox/gossip router (NIP-65). Given pubkeys + an intent (read or write),
// it picks a small set of relays that covers them well, using each author's
// advertised relay list. Policy (where to find relay lists, defaults, quality,
// caps) is injected, so the router stays pure and testable.
import type { Pubkey } from '@hopstr/core'

export interface RouterPolicy {
  /** This author's relays for the given use ('read' = their inbox, 'write' = outbox). */
  getPubkeyRelays(pubkey: Pubkey, use: 'read' | 'write'): string[]
  /** Fallback relays when an author advertises none. */
  getDefaultRelays(): string[]
  /** Optional 0..1 quality weight per relay (higher = preferred). Default 1. */
  getRelayQuality?(url: string): number
  /** Max relays to return per selection. Default 4. */
  getLimit?(): number
}

/** One author routed to one relay, with the weight that relay earned for them. */
export interface Selection {
  relay: string
  pubkeys: Pubkey[]
}

/**
 * Greedy weighted set-cover: score each candidate relay by the (quality-weighted,
 * log-dampened) number of still-uncovered authors it serves, repeatedly take the
 * best, until everyone is covered once or the limit is hit. Log-dampening stops a
 * single mega-relay from absorbing everyone, spreading load realistically.
 */
export class Router {
  #policy: Required<RouterPolicy>

  constructor(policy: RouterPolicy) {
    this.#policy = {
      getPubkeyRelays: policy.getPubkeyRelays.bind(policy),
      getDefaultRelays: policy.getDefaultRelays.bind(policy),
      getRelayQuality: policy.getRelayQuality?.bind(policy) ?? (() => 1),
      getLimit: policy.getLimit?.bind(policy) ?? (() => 4),
    }
  }

  /** Relays to READ a set of authors from (their write/outbox relays). */
  forPubkeys(pubkeys: Pubkey[]): Selection[] {
    return this.#cover(pubkeys, 'write')
  }

  /** Relays to deliver TO a set of recipients (their read/inbox relays). */
  toPubkeys(pubkeys: Pubkey[]): Selection[] {
    return this.#cover(pubkeys, 'read')
  }

  /**
   * Where to publish `event`: the author's write relays, plus the read relays of
   * everyone p-tagged (so mentions land in their inbox). Returns a flat relay list.
   */
  publishEvent(author: Pubkey, mentioned: Pubkey[] = []): string[] {
    const relays = new Set<string>()
    for (const sel of this.#cover([author], 'write')) relays.add(sel.relay)
    for (const sel of this.#cover(mentioned, 'read')) relays.add(sel.relay)
    return [...relays]
  }

  #relaysFor(pubkey: Pubkey, use: 'read' | 'write'): string[] {
    const relays = this.#policy.getPubkeyRelays(pubkey, use)
    return relays.length ? relays : this.#policy.getDefaultRelays()
  }

  #cover(pubkeys: Pubkey[], use: 'read' | 'write'): Selection[] {
    const unique = [...new Set(pubkeys)]
    if (unique.length === 0) return []

    // candidate relay → authors it can serve
    const relayToPubkeys = new Map<string, Set<Pubkey>>()
    for (const pk of unique) {
      for (const relay of this.#relaysFor(pk, use)) {
        const set = relayToPubkeys.get(relay) ?? new Set<Pubkey>()
        set.add(pk)
        relayToPubkeys.set(relay, set)
      }
    }

    const uncovered = new Set(unique)
    const selections: Selection[] = []
    const limit = this.#policy.getLimit()

    while (uncovered.size > 0 && selections.length < limit) {
      let best: { relay: string; covered: Pubkey[]; score: number } | undefined
      for (const [relay, servable] of relayToPubkeys) {
        const newlyCovered = [...servable].filter((pk) => uncovered.has(pk))
        if (newlyCovered.length === 0) continue
        // log-dampened, quality-weighted score
        const score = Math.log2(newlyCovered.length + 1) * this.#policy.getRelayQuality(relay)
        if (
          !best ||
          score > best.score ||
          // deterministic tie-break: more raw coverage, then lower URL
          (score === best.score &&
            (newlyCovered.length > best.covered.length ||
              (newlyCovered.length === best.covered.length && relay < best.relay)))
        ) {
          best = { relay, covered: newlyCovered, score }
        }
      }
      if (!best) break
      selections.push({ relay: best.relay, pubkeys: best.covered })
      for (const pk of best.covered) uncovered.delete(pk)
    }

    return selections
  }
}
