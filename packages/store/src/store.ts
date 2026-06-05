// A reactive in-memory event store. add() does the bookkeeping a Nostr client
// always needs: dedup by id, replaceable/addressable "newest wins", NIP-09
// deletions, NIP-40 expiry. Subscribers get a live stream of accepted events.
import {
  addressOf,
  classifyKind,
  matchFilters,
  type Filter,
  type NostrEvent,
} from '@nostragent/core'

export type AddResult = 'added' | 'duplicate' | 'replaced' | 'outdated' | 'deleted' | 'expired'

type Listener = (event: NostrEvent) => void

/** Optional pluggable backend; the default is in-memory. The interface is tiny
 *  so a sqlite/IndexedDB adapter can drop in later. */
export interface StoreBackend {
  get(id: string): NostrEvent | undefined
  set(id: string, event: NostrEvent): void
  delete(id: string): void
  values(): Iterable<NostrEvent>
}

class MemoryBackend implements StoreBackend {
  #map = new Map<string, NostrEvent>()
  get(id: string): NostrEvent | undefined {
    return this.#map.get(id)
  }
  set(id: string, event: NostrEvent): void {
    this.#map.set(id, event)
  }
  delete(id: string): void {
    this.#map.delete(id)
  }
  values(): Iterable<NostrEvent> {
    return this.#map.values()
  }
}

export interface EventStoreOptions {
  backend?: StoreBackend
  /** Injected clock (seconds) for NIP-40 expiry checks. Default Date.now/1000. */
  now?: () => number
}

export class EventStore {
  #backend: StoreBackend
  #now: () => number
  // newest event id per "replaceable coordinate" (kind:pubkey[:d])
  #coords = new Map<string, string>()
  // event ids that a NIP-09 deletion has tombstoned (so they can't be re-added)
  #deleted = new Set<string>()
  #listeners = new Set<Listener>()

  constructor(options: EventStoreOptions = {}) {
    this.#backend = options.backend ?? new MemoryBackend()
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000))
  }

  /** The NIP-40 expiration timestamp on an event, if any. */
  #expiration(event: NostrEvent): number | undefined {
    const tag = event.tags.find((t) => t[0] === 'expiration')?.[1]
    const ts = tag ? Number(tag) : NaN
    return Number.isFinite(ts) ? ts : undefined
  }

  #isExpired(event: NostrEvent): boolean {
    const exp = this.#expiration(event)
    return exp !== undefined && exp <= this.#now()
  }

  /**
   * Add an event, applying all the standard rules. Returns what happened so
   * callers (and tests) can reason about it.
   */
  add(event: NostrEvent): AddResult {
    if (this.#backend.get(event.id)) return 'duplicate'
    if (this.#deleted.has(event.id)) return 'deleted'
    if (this.#isExpired(event)) return 'expired'

    // NIP-09: a kind-5 deletion tombstones the events/addresses it names.
    if (event.kind === 5) {
      this.#applyDeletion(event)
      this.#store(event)
      return 'added'
    }

    const kindClass = classifyKind(event.kind)
    if (kindClass === 'replaceable' || kindClass === 'addressable') {
      const coord = addressOf(event)
      const currentId = this.#coords.get(coord)
      const current = currentId ? this.#backend.get(currentId) : undefined
      if (current) {
        // newest wins; tie broken by lexically-lower id (NIP-01 convention)
        if (
          current.created_at > event.created_at ||
          (current.created_at === event.created_at && current.id <= event.id)
        ) {
          return 'outdated'
        }
        this.#backend.delete(current.id)
      }
      this.#coords.set(coord, event.id)
      this.#store(event)
      return current ? 'replaced' : 'added'
    }

    this.#store(event)
    return 'added'
  }

  #store(event: NostrEvent): void {
    this.#backend.set(event.id, event)
    for (const listener of this.#listeners) listener(event)
  }

  /** Honor a NIP-09 deletion: remove referenced events by the same author. */
  #applyDeletion(deletion: NostrEvent): void {
    for (const tag of deletion.tags) {
      if (tag[0] === 'e' && tag[1]) {
        this.#deleted.add(tag[1])
        const existing = this.#backend.get(tag[1])
        if (existing && existing.pubkey === deletion.pubkey) this.#backend.delete(tag[1])
      } else if (tag[0] === 'a' && tag[1]) {
        const coordId = this.#coords.get(tag[1])
        const existing = coordId ? this.#backend.get(coordId) : undefined
        if (existing && existing.pubkey === deletion.pubkey) {
          this.#backend.delete(existing.id)
          this.#coords.delete(tag[1])
        }
      }
    }
  }

  /** Get one event by id (skips expired). */
  get(id: string): NostrEvent | undefined {
    const event = this.#backend.get(id)
    if (event && this.#isExpired(event)) {
      this.#backend.delete(id)
      return undefined
    }
    return event
  }

  /** The current newest event for a replaceable/addressable coordinate. */
  getReplaceable(coord: string): NostrEvent | undefined {
    const id = this.#coords.get(coord)
    return id ? this.get(id) : undefined
  }

  /** All stored events matching the filters (newest first), excluding expired. */
  query(filters: Filter[]): NostrEvent[] {
    const out: NostrEvent[] = []
    for (const event of this.#backend.values()) {
      if (this.#isExpired(event)) continue
      if (matchFilters(filters, event)) out.push(event)
    }
    out.sort((a, b) => b.created_at - a.created_at)
    return out
  }

  /** Number of (non-expired) events held. */
  get size(): number {
    let n = 0
    for (const _ of this.#backend.values()) n++
    return n
  }

  /** Subscribe to every accepted event. Returns an unsubscribe function. */
  onEvent(listener: Listener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /**
   * A live AsyncIterable: first replays current matches (newest first), then
   * streams new matching events until `signal` aborts.
   */
  async *stream(filters: Filter[], signal?: AbortSignal): AsyncGenerator<NostrEvent> {
    const queue: NostrEvent[] = []
    const seen = new Set<string>()
    let wake: (() => void) | undefined

    // Attach the live listener BEFORE replaying, so nothing slips through the
    // gap between snapshot and subscribe. Dedup against what we replay.
    const off = this.onEvent((event) => {
      if (matchFilters(filters, event)) {
        queue.push(event)
        wake?.()
      }
    })
    const onAbort = () => wake?.()
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for (const event of this.query(filters)) {
        seen.add(event.id)
        yield event
      }
      while (!signal?.aborted) {
        if (queue.length === 0) await new Promise<void>((resolve) => (wake = resolve))
        while (queue.length) {
          const event = queue.shift()!
          if (!seen.has(event.id)) {
            seen.add(event.id)
            yield event
          }
        }
      }
    } finally {
      off()
      signal?.removeEventListener('abort', onAbort)
    }
  }
}
