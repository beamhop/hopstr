// The optimistic publish "thunk": sign eagerly, add to the local store, defer
// the network until awaited. It's a PromiseLike (so `await` runs the publish)
// with chained .to()/.timeout() options, .undo() (soft-undo before send), and
// .orThrow() (throw if no relay accepts).
import type { NostrEvent } from '@nostragent/core'
import type { PoolPublishResult } from '@nostragent/pool'

export interface PublishDriver {
  /** Resolve target relays (router decides unless overridden). */
  resolveRelays(event: NostrEvent, override?: string[]): string[]
  /** Publish to the given relays (with an optional timeout). */
  send(event: NostrEvent, relays: string[], timeout?: number): Promise<PoolPublishResult[]>
  /** Add the freshly-signed event to the local store (optimistic). */
  store(event: NostrEvent): void
  /** Remove it again (undo). */
  rollback(event: NostrEvent): void
}

export class PublishThunk implements PromiseLike<PoolPublishResult[]> {
  #signing: Promise<NostrEvent>
  #signed: NostrEvent | undefined
  #driver: PublishDriver
  #relayOverride: string[] | undefined
  #timeout: number | undefined
  #undone = false
  #sent: Promise<PoolPublishResult[]> | undefined

  constructor(signing: Promise<NostrEvent>, driver: PublishDriver) {
    this.#driver = driver
    // Sign, then optimistically add to the store (unless already undone).
    this.#signing = signing.then((event) => {
      this.#signed = event
      if (!this.#undone) driver.store(event)
      return event
    })
  }

  /** The signed event, once signing completes. */
  async event(): Promise<NostrEvent> {
    return this.#signing
  }

  /** Override the target relays (bypass the router). Chainable. */
  to(relays: string[]): this {
    this.#relayOverride = relays
    return this
  }

  /** Set a publish timeout (ms). Chainable. */
  timeout(ms: number): this {
    this.#timeout = ms
    return this
  }

  /** Soft-undo: roll the event back out of the local store. No-op once sent. */
  undo(): void {
    if (this.#sent) return
    this.#undone = true
    if (this.#signed) this.#driver.rollback(this.#signed)
  }

  #run(): Promise<PoolPublishResult[]> {
    this.#sent ??= this.#publish()
    return this.#sent
  }

  async #publish(): Promise<PoolPublishResult[]> {
    const event = await this.#signing
    if (this.#undone) return []
    const relays = this.#driver.resolveRelays(event, this.#relayOverride)
    return this.#driver.send(event, relays, this.#timeout)
  }

  then<TResult1 = PoolPublishResult[], TResult2 = never>(
    onfulfilled?: ((value: PoolPublishResult[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.#run().then(onfulfilled, onrejected)
  }

  /** Await and throw if NO relay accepted the event. */
  async orThrow(): Promise<PoolPublishResult[]> {
    const results = await this.#run()
    if (!results.some((r) => r.ok)) {
      const reasons = results.map((r) => `${r.relay}: ${r.reason || 'rejected'}`).join('; ')
      throw new Error(`publish rejected by all relays (${reasons || 'no relays'})`)
    }
    return results
  }
}
