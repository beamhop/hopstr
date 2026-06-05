// A pool of relay connections. Lazily opens one Relay per URL, fans a filter to
// many relays, dedups events by id across relays, and aggregates EOSE.
import type { Filter, NostrEvent } from '@nostragent/core'
import { verifyEvent } from '@nostragent/core'
import { Relay, type PublishResult, type RelayOptions } from '@nostragent/relay'
import { Subscription } from './subscription.ts'

export interface PoolPublishResult extends PublishResult {
  relay: string
}

export interface PoolSubscribeOptions {
  /** Abort to close the subscription. */
  signal?: AbortSignal
  /** Verify each event's id+sig before delivering (default true). */
  verify?: boolean
}

export interface PoolOptions {
  /** Per-relay options (injected WebSocket/clock/auth flow through here). */
  relay?: RelayOptions
  /** Normalize a URL before using it as the pool key (default: trim trailing /). */
  normalizeUrl?: (url: string) => string
}

function defaultNormalize(url: string): string {
  return url.replace(/\/+$/, '')
}

export class Pool {
  #relays = new Map<string, Relay>()
  #opts: PoolOptions
  #normalize: (url: string) => string

  constructor(options: PoolOptions = {}) {
    this.#opts = options
    this.#normalize = options.normalizeUrl ?? defaultNormalize
  }

  /** Get (or lazily open) the Relay for a URL. */
  relay(url: string): Relay {
    const key = this.#normalize(url)
    let relay = this.#relays.get(key)
    if (!relay) {
      relay = new Relay(key, this.#opts.relay)
      this.#relays.set(key, relay)
    }
    return relay
  }

  /** The set of relay URLs the pool currently tracks. */
  get urls(): string[] {
    return [...this.#relays.keys()]
  }

  /**
   * Subscribe across `relays` with `filters`. Returns a Subscription that
   * dedups by event id and fires EOSE once every relay has sent EOSE.
   */
  subscribe(relays: string[], filters: Filter[], options: PoolSubscribeOptions = {}): Subscription {
    const verify = options.verify ?? true
    const keys = [...new Set(relays.map(this.#normalize))]
    const seen = new Set<string>()
    let eoseCount = 0
    const unsubs: Array<() => void> = []

    const sub = new Subscription(() => {
      for (const u of unsubs) u()
    }, options.signal)

    for (const key of keys) {
      const relay = this.relay(key)
      const unsub = relay.subscribe(filters, {
        onEvent: (event) => {
          if (seen.has(event.id)) return
          if (verify && !verifyEvent(event)) return
          seen.add(event.id)
          sub._push(event)
        },
        onEose: () => {
          eoseCount++
          if (eoseCount >= keys.length) sub._eose()
        },
      })
      unsubs.push(unsub)
    }
    // no relays → EOSE immediately so .all()/.take() resolve
    if (keys.length === 0) sub._eose()

    return sub
  }

  /** One-shot query: subscribe, collect to EOSE, return the deduped events. */
  query(relays: string[], filter: Filter, options: PoolSubscribeOptions = {}): Promise<NostrEvent[]> {
    return this.subscribe(relays, [filter], options).all()
  }

  /** One-shot single-event query (newest-first if the relay honors limit). */
  async queryOne(relays: string[], filter: Filter, options: PoolSubscribeOptions = {}): Promise<NostrEvent | null> {
    const events = await this.subscribe(relays, [{ ...filter, limit: 1 }], options).all()
    if (events.length === 0) return null
    return events.reduce((newest, e) => (e.created_at > newest.created_at ? e : newest))
  }

  /** Publish an event to many relays; resolves per-relay results (never throws). */
  async publish(relays: string[], event: NostrEvent): Promise<PoolPublishResult[]> {
    const keys = [...new Set(relays.map(this.#normalize))]
    return Promise.all(
      keys.map(async (key) => {
        const result = await this.relay(key).publish(event)
        return { relay: key, ...result }
      }),
    )
  }

  /** Close one relay (and forget it). */
  closeRelay(url: string): void {
    const key = this.#normalize(url)
    this.#relays.get(key)?.close()
    this.#relays.delete(key)
  }

  /** Close every relay connection. */
  close(): void {
    for (const relay of this.#relays.values()) relay.close()
    this.#relays.clear()
  }
}
