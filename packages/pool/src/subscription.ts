// A Subscription is BOTH an AsyncIterable<NostrEvent> (for-await, break = close)
// AND a thenable-ish object with .all()/.first()/.take()/.on(). One type, no
// sub-id bookkeeping, no callback sprawl.
import type { NostrEvent } from '@nostragent/core'

export type SubscriptionEvent = 'event' | 'eose' | 'close'

interface Waiter {
  resolve: (r: IteratorResult<NostrEvent>) => void
}

/**
 * Pull-based async stream of events with convenience collectors. The producer
 * (the Pool) pushes via `_push`/`_eose`/`_close`; consumers use for-await or the
 * promise helpers. Closing (via break, .close(), or an AbortSignal) tears down
 * the underlying relay subscriptions through the injected `onClose`.
 */
export class Subscription implements AsyncIterable<NostrEvent> {
  #buffer: NostrEvent[] = []
  #waiters: Waiter[] = []
  #closed = false
  #eosed = false
  #onClose: () => void
  #listeners = new Map<SubscriptionEvent, Set<(arg?: unknown) => void>>()

  constructor(onClose: () => void, signal?: AbortSignal) {
    this.#onClose = onClose
    if (signal) {
      if (signal.aborted) this.close()
      else signal.addEventListener('abort', () => this.close(), { once: true })
    }
  }

  // ── producer side (called by the Pool) ──
  _push(event: NostrEvent): void {
    if (this.#closed) return
    this.#emit('event', event)
    const waiter = this.#waiters.shift()
    if (waiter) waiter.resolve({ value: event, done: false })
    else this.#buffer.push(event)
  }

  _eose(): void {
    if (this.#eosed) return
    this.#eosed = true
    this.#emit('eose')
  }

  _close(): void {
    this.close()
  }

  // ── consumer side ──
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#emit('close')
    for (const w of this.#waiters.splice(0)) w.resolve({ value: undefined, done: true })
    this.#onClose()
  }

  /** Register an event/eose/close listener. Returns an unsubscribe function. */
  on(type: SubscriptionEvent, cb: (arg?: unknown) => void): () => void {
    const set = this.#listeners.get(type) ?? new Set()
    set.add(cb)
    this.#listeners.set(type, set)
    return () => set.delete(cb)
  }

  #emit(type: SubscriptionEvent, arg?: unknown): void {
    const set = this.#listeners.get(type)
    if (set) for (const cb of set) cb(arg)
  }

  [Symbol.asyncIterator](): AsyncIterator<NostrEvent> {
    return {
      next: (): Promise<IteratorResult<NostrEvent>> => {
        const buffered = this.#buffer.shift()
        if (buffered) return Promise.resolve({ value: buffered, done: false })
        if (this.#closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise<IteratorResult<NostrEvent>>((resolve) => this.#waiters.push({ resolve }))
      },
      return: (): Promise<IteratorResult<NostrEvent>> => {
        this.close()
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }

  /** Collect events until EOSE (then auto-close); resolves with all of them. */
  all(): Promise<NostrEvent[]> {
    return new Promise((resolve) => {
      const collected: NostrEvent[] = [...this.#buffer]
      if (this.#eosed || this.#closed) {
        this.close()
        resolve(collected)
        return
      }
      this.on('event', (e) => collected.push(e as NostrEvent))
      const finish = () => {
        this.close()
        resolve(collected)
      }
      this.on('eose', finish)
      this.on('close', finish)
    })
  }

  /** The first event, or null if the stream closes/EOSEs with nothing. */
  async first(): Promise<NostrEvent | null> {
    for await (const e of this) {
      this.close()
      return e
    }
    return null
  }

  /** The first `n` events (auto-closes once it has them or the stream ends). */
  async take(n: number): Promise<NostrEvent[]> {
    const out: NostrEvent[] = []
    if (n <= 0) {
      this.close()
      return out
    }
    for await (const e of this) {
      out.push(e)
      if (out.length >= n) break
    }
    this.close()
    return out
  }
}
