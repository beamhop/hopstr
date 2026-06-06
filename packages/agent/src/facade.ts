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
import { nip02, nip10, nip17, nip18, nip25 } from '@hopstr/nips'

export { createIdentity, loadIdentity, type Identity }

export const DEFAULT_RELAYS: string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
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

function toFeedNote(e: NostrEvent): FeedNote {
  return { id: e.id, author: e.pubkey, created_at: e.created_at, content: e.content, tags: e.tags }
}

function toNpubHex(idOrNpub: string): Pubkey {
  return idOrNpub.startsWith('npub1') ? nip19.decodeNpub(idOrNpub) : parsePubkey(idOrNpub)
}

/**
 * The classic NostrClient. Construct with an Identity (and optional relays); use
 * the same methods the CLI always has. It owns a modern `Nostr` client inside.
 */
export class NostrClient {
  readonly identity: Identity
  readonly nostr: Nostr
  #relays: string[]

  constructor(identity: Identity, relays: string[] = DEFAULT_RELAYS) {
    this.identity = identity
    this.#relays = relays
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

  async #fetch(eventId: string): Promise<NostrEvent | null> {
    return this.nostr.queryOne({ ids: [eventId] })
  }

  #sorted(events: NostrEvent[]): NostrEvent[] {
    return [...events].sort((a, b) => b.created_at - a.created_at)
  }
}
