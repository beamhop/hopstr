// The drop-in NostrClient facade — the "easy mode" surface the nostr-agent CLI
// uses, with the exact method names and JSON return shapes of the original,
// implemented over the full @hopstr stack. DMs use NIP-17 (read legacy too).
import {
  createIdentity,
  loadIdentity,
  nip19,
  parsePubkey,
  type Filter,
  type Identity,
  type NostrEvent,
  type Pubkey,
} from '@hopstr/core'
import { Nostr } from '@hopstr/client'
import { privateKeySigner, nip04Decrypt } from '@hopstr/signers'
import { nip02, nip10, nip17, nip18, nip25, discovery } from '@hopstr/nips'

export { createIdentity, loadIdentity, type Identity }

export const DEFAULT_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.nostr.band',
]

// Well-known indexer/metadata relays that clients (iris, Damus, etc.) query to
// discover a user's relay lists (kind-10002/10050) and profile. We broadcast our
// kind-10050 here so senders can actually find it. https://nips.nostr.com/65
export const DM_INDEXER_RELAYS: string[] = [
  'wss://purplepag.es',
  'wss://user.kindpag.es',
  'wss://relay.nostr.band',
]

/** The shape feeds/mentions/hashtag return — stable across the CLI. */
export interface FeedNote {
  id: string
  author: string
  created_at: number
  content: string
  tags: string[][]
}

/** A decrypted DM as the CLI expects it. */
export interface DM {
  from: string
  text: string
  at: number
}

export interface PublishOk {
  ok: boolean
  id: string
}

/** One node in a thread: an event and its (chronologically sorted) child replies. */
export interface ThreadNode {
  event: NostrEvent
  children: ThreadNode[]
}

/** A reconstructed conversation, rooted at the thread root. */
export interface Thread {
  /** The thread root (the topmost event we could resolve). */
  root: NostrEvent
  /** The event the caller asked about (equals `root` for a single-node thread). */
  target: NostrEvent
  /** Every event in the tree, deduped — handy for resolving author names. */
  events: NostrEvent[]
  /** The nested tree, rooted at `root`; children are sorted oldest→newest. */
  tree: ThreadNode
}

function toFeedNote(e: NostrEvent): FeedNote {
  return { id: e.id, author: e.pubkey, created_at: e.created_at, content: e.content, tags: e.tags }
}

function toNpubHex(idOrNpub: string): Pubkey {
  return idOrNpub.startsWith('npub1') ? nip19.decodeNpub(idOrNpub) : parsePubkey(idOrNpub)
}

// The immediate parent of an event: for a NIP-22 comment (kind 1111) it's the
// lowercase `e` tag; for a NIP-10 note it's the `reply` marker, falling back to
// `root` (a direct reply to the root carries only a root marker).
function parentId(e: NostrEvent): string | undefined {
  if (e.kind === 1111) return e.tags.find((t) => t[0] === 'e' && t[1])?.[1]
  const refs = nip10.parseThread(e)
  return refs.reply?.id ?? refs.root?.id
}

// The thread root an event belongs to: NIP-22 puts it in the uppercase `E` tag
// (nip10.parseThread only reads lowercase tags), NIP-10 in the `root` marker.
function rootId(e: NostrEvent): string | undefined {
  if (e.kind === 1111) return e.tags.find((t) => t[0] === 'E' && t[1])?.[1]
  return nip10.parseThread(e).root?.id
}

/**
 * The classic NostrClient. Construct with an Identity (and optional relays); use
 * the same methods the CLI always has. It owns a modern `Nostr` client inside.
 */
export class NostrClient {
  readonly identity: Identity
  readonly nostr: Nostr
  #relays: string[]

  // When the caller didn't pick relays, we add the well-known indexer relays to
  // discovery broadcasts (kind-0/3/10002/10050). With explicit relays we respect
  // them exactly — no surprise outbound connections (also keeps tests hermetic).
  readonly #usingDefaultRelays: boolean

  constructor(identity: Identity, relays: string[] = DEFAULT_RELAYS) {
    this.identity = identity
    this.#relays = relays
    this.#usingDefaultRelays = relays === DEFAULT_RELAYS
    this.nostr = Nostr.fromOptions({ signer: privateKeySigner(identity.secretKey), relays, outbox: false })
  }

  get pubkey(): Pubkey {
    return this.identity.pubkey
  }
  get npub(): string {
    return this.identity.npub
  }

  // ── posting ──

  async post(content: string, tags: string[][] = []): Promise<PublishOk> {
    const thunk = this.nostr.note(content, tags)
    const event = await thunk.event()
    await thunk
    return { ok: true, id: event.id }
  }

  async reply(eventId: string, content: string): Promise<PublishOk> {
    const parent = await this.#fetch(eventId)
    if (!parent) throw new Error(`event ${eventId} not found on relays`)
    return this.publish({ kind: 1, content, tags: nip10.replyTags(parent) })
  }

  async react(eventId: string, content = '+'): Promise<PublishOk> {
    const target = await this.#fetch(eventId)
    if (!target) throw new Error(`event ${eventId} not found on relays`)
    return this.publish(nip25.react(target, content))
  }

  async repost(eventId: string): Promise<PublishOk> {
    const target = await this.#fetch(eventId)
    if (!target) throw new Error(`event ${eventId} not found on relays`)
    return this.publish(nip18.repost(target))
  }

  /** Publish any template; returns `{ok, id}`. */
  async publish(template: { kind: number; content: string; tags: string[][]; created_at?: number }): Promise<PublishOk> {
    const thunk = this.nostr.publish(template)
    const event = await thunk.event()
    await thunk
    return { ok: true, id: event.id }
  }

  // ── reading ──

  async feed(options: { limit?: number; authors?: string[] } = {}): Promise<FeedNote[]> {
    const filter: Filter = { kinds: [1], limit: options.limit ?? 20 }
    if (options.authors) filter.authors = options.authors.map((a) => toNpubHex(a))
    const events = await this.nostr.query(filter)
    return this.#sorted(events).map(toFeedNote)
  }

  async hashtag(tag: string, options: { limit?: number } = {}): Promise<FeedNote[]> {
    const events = await this.nostr.query({ kinds: [1], '#t': [tag.replace(/^#/, '')], limit: options.limit ?? 20 })
    return this.#sorted(events).map(toFeedNote)
  }

  async mentions(options: { limit?: number } = {}): Promise<FeedNote[]> {
    const events = await this.nostr.query({ kinds: [1], '#p': [this.pubkey], limit: options.limit ?? 20 })
    return this.#sorted(events.filter((e) => e.pubkey !== this.pubkey)).map(toFeedNote)
  }

  // ── threads ──

  /**
   * Reconstruct the whole conversation that an event belongs to, from ANY node —
   * a root note, a mid-thread reply, or a NIP-22 comment. Accepts a raw hex id,
   * a `note1…`, or an `nevent1…`. We find the thread root, then expand its replies
   * breadth-first (so even replies that only tag their immediate parent are caught)
   * and assemble a parent→children tree. Throws if the starting event isn't found.
   */
  async thread(eventId: string): Promise<Thread> {
    const startId = this.#eventIdFromInput(eventId)
    const start = await this.#fetch(startId)
    if (!start) throw new Error(`event ${startId} not found on relays`)

    // 1) climb to the root. The root marker usually points there directly; if it's
    // missing (legacy/positional events) we walk parent links until one has none.
    let root = start
    const markedRoot = rootId(start)
    if (markedRoot && markedRoot !== start.id) {
      const fetched = await this.#fetch(markedRoot)
      if (fetched) root = fetched
    } else {
      let pid = parentId(root)
      for (let hops = 0; pid && pid !== root.id && hops < 64; hops++) {
        const parent = await this.#fetch(pid)
        if (!parent) break
        root = parent
        pid = parentId(parent)
      }
    }

    // 2) gather every descendant of the root, breadth-first.
    const byId = new Map<string, NostrEvent>([
      [root.id, root],
      [start.id, start],
    ])
    let frontier: string[] = [root.id]
    for (let depth = 0; frontier.length && depth < 64; depth++) {
      const kids = await this.nostr.query({ kinds: [1, 1111], '#e': frontier })
      // NIP-22 comments may tag the root only via the uppercase `E` scope tag —
      // sweep those in once, against the root.
      const rootScoped = depth === 0 ? await this.nostr.query({ '#E': [root.id] }) : []
      const next: string[] = []
      for (const e of [...kids, ...rootScoped]) {
        if (byId.has(e.id)) continue
        byId.set(e.id, e)
        next.push(e.id)
      }
      frontier = next
    }

    // 3) build the tree (children sorted oldest→newest; orphans attach to root).
    const childrenOf = new Map<string, NostrEvent[]>()
    for (const e of byId.values()) {
      if (e.id === root.id) continue
      const pid = parentId(e)
      const parent = pid && byId.has(pid) ? pid : root.id
      const list = childrenOf.get(parent)
      if (list) list.push(e)
      else childrenOf.set(parent, [e])
    }
    const build = (e: NostrEvent): ThreadNode => ({
      event: e,
      children: (childrenOf.get(e.id) ?? []).sort((a, b) => a.created_at - b.created_at).map(build),
    })

    return { root, target: byId.get(start.id) ?? start, events: [...byId.values()], tree: build(root) }
  }

  // ── social graph ──

  async follow(pubkeyOrNpub: string): Promise<PublishOk> {
    const pk = toNpubHex(pubkeyOrNpub)
    const current = await this.#followSet()
    current.add(pk)
    return this.#publishFollows(current)
  }

  async unfollow(pubkeyOrNpub: string): Promise<PublishOk> {
    const pk = toNpubHex(pubkeyOrNpub)
    const current = await this.#followSet()
    current.delete(pk)
    return this.#publishFollows(current)
  }

  #publishFollows(set: Set<string>): Promise<PublishOk> {
    const template = nip02.followList([...set].map((pubkey) => ({ pubkey })))
    // ensure a strictly-increasing created_at so the replaceable store always
    // accepts the update, even on rapid same-second follow/unfollow.
    template.created_at = this.#nextReplaceableTime(3)
    return this.publish(template)
  }

  /** A created_at strictly newer than our stored replaceable of `kind`. */
  #nextReplaceableTime(kind: number): number {
    const now = Math.floor(Date.now() / 1000)
    const existing = this.nostr.store.getReplaceable(`${kind}:${this.pubkey}:`)
    return existing ? Math.max(now, existing.created_at + 1) : now
  }

  /** Who someone follows (defaults to YOU); returns hex pubkeys. */
  async following(pubkeyOrNpub?: string): Promise<string[]> {
    const pk = pubkeyOrNpub ? toNpubHex(pubkeyOrNpub) : this.pubkey
    // For our own list, trust the local store (our latest optimistic write);
    // otherwise read it from relays.
    if (pk === this.pubkey) {
      const local = this.nostr.store.getReplaceable(`3:${pk}:`)
      if (local) return nip02.followedPubkeys(local)
    }
    const event = await this.nostr.queryOne({ kinds: [3], authors: [pk] })
    return event ? nip02.followedPubkeys(event) : []
  }

  async #followSet(): Promise<Set<string>> {
    // following() reads our own latest list from the local store, so rapid
    // successive follow()/unfollow() compose correctly even within one second.
    return new Set(await this.following())
  }

  // ── profile ──

  async setProfile(metadata: Record<string, unknown>): Promise<PublishOk> {
    return this.publish({ kind: 0, content: JSON.stringify(metadata), tags: [] })
  }

  async getProfile(pubkeyOrNpub: string): Promise<Record<string, unknown> | null> {
    const event = await this.nostr.profile(toNpubHex(pubkeyOrNpub))
    if (!event) return null
    try {
      return JSON.parse(event.content) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  // ── encrypted DMs (NIP-17, with legacy kind-4 read) ──

  // Make ourselves DM-able. Other clients (iris.to, Damus, etc.) follow a two-step
  // discovery dance before they'll let someone DM you — and BOTH events must exist,
  // or they show "This user has not enabled encrypted messaging yet":
  //   1. kind-10002 (NIP-65): "here are the relays where you'll find my events."
  //      https://nips.nostr.com/65
  //   2. kind-10050 (NIP-17): "here's where to deliver my gift-wrapped DMs."
  //      https://nips.nostr.com/17
  // A sender reads (1) to learn your relays, then looks there for (2). Publishing
  // only (2) isn't enough — without (1) the sender never knows to look on your
  // relays in the first place. We publish both, broadcasting widely (our relays
  // plus well-known indexer relays) so the events are discoverable. Both kinds are
  // replaceable, so re-publishing on every startup is safe.
  async enableDirectMessages(relays: string[] = this.#relays): Promise<{ relayList: PublishOk; dmRelays: PublishOk }> {
    const relayList = await this.#broadcast(discovery.relayListMetadata(relays.map((url) => ({ url }))))
    const dmRelays = await this.#broadcast(nip17.dmRelayList(relays))
    return { relayList, dmRelays }
  }

  // Publish a replaceable list event to our relays + indexer relays so senders can
  // discover it no matter which relay set they query. A per-publish timeout is
  // essential: pool.publish awaits EVERY relay, and some indexer relays (e.g.
  // purplepag.es) accept connections but never answer — without the cap this would
  // hang forever. Relays that don't answer in time are simply reported failed.
  async #broadcast(template: { kind: number; content: string; tags: string[][] }): Promise<PublishOk> {
    const targets = this.#usingDefaultRelays ? [...new Set([...this.#relays, ...DM_INDEXER_RELAYS])] : this.#relays
    const thunk = this.nostr.publish(template).to(targets).timeout(8000)
    const event = await thunk.event()
    await thunk
    return { ok: true, id: event.id }
  }

  // ── one-time network presence bootstrap ──

  /**
   * Establish full network presence — the four things a fresh identity needs so
   * other clients can find, read, and message it. Safe to run on every startup:
   * kind-0/kind-3 are only created when MISSING (so we never clobber a profile or
   * follow list you set elsewhere); kind-10002/kind-10050 are pure routing metadata
   * and are always refreshed.
   *   1. kind-0  profile metadata (NIP-01) — placeholder name if you have none yet
   *   2. kind-10002 relay list (NIP-65)    — where your events live (gossip model)
   *   3. kind-10050 DM relay list (NIP-17) — where to deliver private messages
   *   4. kind-3  contact list (NIP-02)     — initial empty list to seed your graph
   */
  async bootstrap(relays: string[] = this.#relays): Promise<{
    profile: PublishOk | 'exists'
    relayList: PublishOk
    dmRelays: PublishOk
    contacts: PublishOk | 'exists'
  }> {
    // Run all four publishes concurrently — each waits on slow/flaky relays up to
    // its own timeout, so serializing them would stack those waits (~30s+). In
    // parallel the whole bootstrap finishes in roughly one timeout window.
    const [profile, relayList, dmRelays, contacts] = await Promise.all([
      this.#ensureProfile(),
      this.#broadcast(discovery.relayListMetadata(relays.map((url) => ({ url })))),
      this.#broadcast(nip17.dmRelayList(relays)),
      this.#ensureContacts(),
    ])
    return { profile, relayList, dmRelays, contacts }
  }

  // Publish a minimal kind-0 ONLY if none exists — a placeholder is better than an
  // unreadable hex pubkey, but we must never overwrite a real profile set elsewhere.
  // Routed through #broadcast so it's both widely discoverable and timeout-bounded.
  async #ensureProfile(): Promise<PublishOk | 'exists'> {
    if (await this.#exists(0)) return 'exists'
    return this.#broadcast({ kind: 0, content: JSON.stringify({ name: this.npub.slice(0, 12) }), tags: [] })
  }

  // Publish an empty kind-3 ONLY if none exists — seeds the social graph without
  // ever wiping a follow list you've built in another client.
  async #ensureContacts(): Promise<PublishOk | 'exists'> {
    if (await this.#exists(3)) return 'exists'
    return this.#broadcast(nip02.followList([]))
  }

  // Does a replaceable event of `kind` already exist for us? This guards the
  // kind-0/kind-3 publishes so we never overwrite a profile/contact list set
  // elsewhere. The subtlety: a pooled query resolves "not found" only once EVERY
  // relay sends EOSE, so one stalled relay (purplepag.es, relay.nostr.band, …)
  // would make it hang. We ask each relay separately (each capped to ~6s); if any
  // healthy relay has the event we report "exists", otherwise once they've all
  // settled we report "not found". A relay that times out counts as "not found"
  // for itself — but if it actually held the only copy we'd rather skip than
  // overwrite, so #ensure* publishes are themselves idempotent/replaceable-safe.
  async #exists(kind: number): Promise<boolean> {
    const filter: Filter = { kinds: [kind], authors: [this.pubkey] }
    const cap = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 6000))])
    const perRelay = this.#relays.map((relay) =>
      cap(this.nostr.queryOne(filter, { relays: [relay] }).then(Boolean).catch(() => false), false),
    )
    const hits = await Promise.all(perRelay)
    return hits.some(Boolean)
  }

  async sendDM(pubkeyOrNpub: string, text: string): Promise<PublishOk> {
    const recipient = toNpubHex(pubkeyOrNpub)
    const wraps = nip17.sealDirectMessage({ text, to: [recipient] }, this.identity.secretKey)
    let firstId = ''
    // Each gift wrap is ALREADY signed (by its ephemeral key) — publish it
    // directly via the pool; do NOT re-sign through nostr.publish().
    for (const { wrap } of wraps) {
      const results = await this.nostr.pool.publish(this.#relays, wrap)
      if (!firstId && results.some((r) => r.ok)) firstId = wrap.id
    }
    return { ok: true, id: firstId || wraps[0]!.wrap.id }
  }

  /** Full decrypted conversation with a peer, oldest→newest. NIP-17 + legacy kind-4. */
  async readDMs(pubkeyOrNpub: string, options: { limit?: number } = {}): Promise<DM[]> {
    const peer = toNpubHex(pubkeyOrNpub)
    const limit = options.limit ?? 50
    const messages: DM[] = []

    // NIP-17: gift wraps addressed to me (kind 1059, #p = me)
    const wraps = await this.nostr.query({ kinds: [1059], '#p': [this.pubkey], limit })
    for (const wrap of wraps) {
      try {
        const msg = nip17.openDirectMessage(wrap, this.identity.secretKey)
        if (msg.from === peer || msg.to.includes(peer) || msg.from === this.pubkey) {
          messages.push({ from: msg.from, text: msg.text, at: msg.at })
        }
      } catch {
        // not a DM for me / unreadable
      }
    }

    // Legacy kind-4 (read-only): direct AES-encrypted DMs both directions
    const legacy = await this.nostr.query({
      kinds: [4],
      authors: [this.pubkey, peer],
      '#p': [this.pubkey, peer],
      limit,
    })
    for (const e of legacy) {
      const counterparty = e.pubkey === this.pubkey ? peer : e.pubkey
      try {
        messages.push({ from: e.pubkey, text: nip04Decrypt(this.identity.secretKey, counterparty, e.content), at: e.created_at })
      } catch {
        // undecryptable
      }
    }

    return messages.sort((a, b) => a.at - b.at)
  }

  /**
   * Decrypt a single legacy kind-4 DM event (NIP-04). The counterparty (whose key
   * we derive the shared secret with) is the sender for an incoming message, or the
   * `p`-tagged recipient for one we sent. Returns the plaintext, or null if it isn't
   * for us / can't be decrypted. https://nips.nostr.com/4
   */
  decryptLegacyDM(event: NostrEvent): string | null {
    const recipient = event.tags.find((t) => t[0] === 'p')?.[1]
    const counterparty = event.pubkey === this.pubkey ? recipient : event.pubkey
    if (!counterparty) return null
    try {
      return nip04Decrypt(this.identity.secretKey, counterparty, event.content)
    } catch {
      return null
    }
  }

  // ── low-level passthrough ──

  subscribe(filter: Filter, onEvent: (e: NostrEvent) => void): () => void {
    const sub = this.nostr.subscribe(filter)
    sub.on('event', (e) => onEvent(e as NostrEvent))
    return () => sub.close()
  }

  query(filter: Filter): Promise<NostrEvent[]> {
    return this.nostr.query(filter)
  }

  queryOne(filter: Filter): Promise<NostrEvent | null> {
    return this.nostr.queryOne(filter)
  }

  close(): void {
    this.nostr.close()
  }

  // Fetch an immutable event by id. Every relay holds the identical event, so the
  // FIRST to answer is final — fetchOne resolves immediately instead of waiting out
  // every relay's EOSE. This is the hot path for reply/react/thread; before it had
  // no timeout, one stalled relay hung the command forever and nothing published.
  async #fetch(eventId: string): Promise<NostrEvent | null> {
    return this.nostr.fetchOne({ ids: [eventId] })
  }

  // Accept a raw hex id, a `note1…`, or an `nevent1…`. A malformed hex string
  // just falls through and yields "not found" when fetched.
  #eventIdFromInput(input: string): string {
    if (input.startsWith('note1')) return nip19.decodeNote(input)
    if (input.startsWith('nevent1')) return nip19.decodeNevent(input).id
    return input
  }

  #sorted(events: NostrEvent[]): NostrEvent[] {
    return [...events].sort((a, b) => b.created_at - a.created_at)
  }
}
