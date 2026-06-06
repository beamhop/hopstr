// Nostr — the high-level, configured-once client. Wires pool + router + store +
// signer together. Outbox routing is on by default; every call can override.
import {
  buildNote,
  createIdentity,
  parsePubkey,
  type EventTemplate,
  type Filter,
  type NostrEvent,
  type Pubkey,
} from '@hopstr/core'
import { type Signer, LocalSigner } from '@hopstr/signers'
import { Pool, type PoolPublishResult, type Subscription } from '@hopstr/pool'
import { Router } from '@hopstr/router'
import { EventStore } from '@hopstr/store'
import { storeBackedPolicy } from './policy.ts'
import { PublishThunk } from './publish.ts'

export const DEFAULT_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
]

export interface NostrOptions {
  /** A signer (local, NIP-07, NIP-46). If omitted, pass `secretKey`/`nsec`. */
  signer?: Signer
  /** Shorthand: build a LocalSigner from a secret (nsec / hex / bytes). */
  secretKey?: string | Uint8Array
  /** Read/write/default relay set. Defaults to a sane public set. */
  relays?: string[]
  /** Turn the outbox/NIP-65 router off (just use the relay set). Default on. */
  outbox?: boolean
  /** Inject a Pool (tests pass one wired to in-process relays). */
  pool?: Pool
  /** Inject an EventStore. */
  store?: EventStore
  /** Read-only: don't create a signer. Reading works; signing throws. */
  readOnly?: boolean
}

export class Nostr {
  readonly pool: Pool
  readonly store: EventStore
  readonly router: Router
  readonly relays: string[]
  #signer: Signer | undefined
  #outbox: boolean
  #profileCache = new Map<string, NostrEvent>()

  private constructor(options: NostrOptions) {
    this.relays = options.relays ?? DEFAULT_RELAYS
    this.pool = options.pool ?? new Pool()
    this.store = options.store ?? new EventStore()
    this.router = new Router(storeBackedPolicy(this.store, this.relays))
    this.#outbox = options.outbox ?? true
    this.#signer = options.signer ?? (options.secretKey ? new LocalSigner(options.secretKey) : undefined)
  }

  /**
   * Create a client. With no signer/secret, a fresh random LocalSigner is made
   * (handy for read-mostly or throwaway use). Async to leave room for runtime
   * setup (e.g. awaiting a NIP-07 extension) without a breaking change.
   */
  static async create(options: NostrOptions = {}): Promise<Nostr> {
    const opts = { ...options }
    if (!opts.signer && !opts.secretKey && !opts.readOnly) {
      opts.secretKey = createIdentity().secretKey
    }
    return new Nostr(opts)
  }

  /**
   * Synchronous constructor for when you already have a signer or secret (no
   * async runtime setup needed). The facade and tests use this.
   */
  static fromOptions(options: NostrOptions): Nostr {
    return new Nostr(options)
  }

  /** The signer, or throw a helpful error if this is a read-only client. */
  get signer(): Signer {
    if (!this.#signer) throw new Error('this client has no signer; pass { signer } or { secretKey } to create()')
    return this.#signer
  }

  /** The user's public key. */
  async pubkey(): Promise<Pubkey> {
    return this.signer.getPublicKey()
  }

  // ── writing ──

  /** Post a kind-1 text note. Returns the publish thunk. */
  note(content: string, tags: string[][] = []): PublishThunk {
    return this.publish(buildNote(content).addTags(tags))
  }

  /**
   * Sign `template` and publish it. Signing starts immediately and the event is
   * added to the local store optimistically; the relay I/O is deferred until the
   * thunk is awaited (so `.undo()`, `.to()`, `.timeout()` can run first).
   */
  publish(template: EventTemplate): PublishThunk {
    return new PublishThunk(this.signer.signEvent(template), {
      resolveRelays: (event, override) => this.#publishRelays(event, override),
      send: (event, relays, timeout) => {
        const publishing = this.pool.publish(relays, event)
        if (timeout === undefined) return publishing
        // per-publish timeout: relays that haven't answered are reported failed
        return Promise.race([
          publishing,
          new Promise<typeof publishing extends Promise<infer R> ? R : never>((resolve) =>
            setTimeout(() => resolve(relays.map((relay) => ({ relay, ok: false, reason: 'timeout' }))), timeout),
          ),
        ])
      },
      store: (event) => {
        this.store.add(event)
      },
      rollback: (event) => {
        this.store.delete(event.id)
      },
    })
  }

  #publishRelays(event: NostrEvent, override?: string[]): string[] {
    if (override && override.length) return override
    if (!this.#outbox) return this.relays
    const mentioned = event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => parsePubkey(t[1]!))
    const relays = this.router.publishEvent(event.pubkey, mentioned)
    return relays.length ? relays : this.relays
  }

  // ── reading ──

  /** Subscribe to events matching `filter`. Returns an AsyncIterable Subscription. */
  subscribe(filter: Filter, options: { relays?: string[]; signal?: AbortSignal } = {}): Subscription {
    const relays = options.relays ?? this.#readRelays(filter)
    const sub = this.pool.subscribe(relays, [filter], options.signal ? { signal: options.signal } : {})
    // mirror everything into the store so it stays warm + reactive
    sub.on('event', (e) => this.store.add(e as NostrEvent))
    return sub
  }

  /** Sugar for `subscribe({ kinds: [1], ...filter })` — a notes feed. */
  notes(filter: Filter = {}, options: { relays?: string[]; signal?: AbortSignal } = {}): Subscription {
    return this.subscribe({ kinds: [1], ...filter }, options)
  }

  /** One-shot query to EOSE (deduped across relays). */
  query(filter: Filter, options: { relays?: string[] } = {}): Promise<NostrEvent[]> {
    return this.subscribe(filter, options).all()
  }

  /** One-shot single newest event. */
  async queryOne(filter: Filter, options: { relays?: string[] } = {}): Promise<NostrEvent | null> {
    const events = await this.subscribe({ ...filter, limit: 1 }, options).all()
    if (events.length === 0) return null
    return events.reduce((newest, e) => (e.created_at > newest.created_at ? e : newest))
  }

  #readRelays(filter: Filter): string[] {
    if (!this.#outbox || !filter.authors?.length) return this.relays
    const relays = this.router.forPubkeys(filter.authors.map((a) => parsePubkey(a))).map((s) => s.relay)
    return relays.length ? relays : this.relays
  }

  // ── profiles ──

  /** Fetch (and cache) a kind-0 profile event for a pubkey. */
  async profile(pubkey: string | Pubkey): Promise<NostrEvent | null> {
    const pk = parsePubkey(pubkey)
    const cached = this.#profileCache.get(pk)
    if (cached) return cached
    const event = await this.queryOne({ kinds: [0], authors: [pk] })
    if (event) this.#profileCache.set(pk, event)
    return event
  }

  /** Clear the profile cache (e.g. after a known profile update). */
  clearProfileCache(): void {
    this.#profileCache.clear()
  }

  /** Close all relay connections. */
  close(): void {
    this.pool.close()
  }
}
