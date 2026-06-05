// NIP-51 lists & sets. Public items live in tags; private items are a NIP-44
// self-encrypted JSON array of tags in `content`. One generic engine, keyed by kind.
import { nip44, type EventTemplate, type NostrEvent } from '@nostragent/core'

// Standard replaceable lists
export const MUTE = 10000
export const PINNED = 10001
export const BOOKMARKS = 10003
export const COMMUNITIES = 10004
export const PUBLIC_CHATS = 10005
export const INTERESTS = 10015
export const EMOJIS = 10030
// Sets (addressable)
export const FOLLOW_SETS = 30000
export const RELAY_SETS = 30002
export const BOOKMARK_SETS = 30003
export const INTEREST_SETS = 30015
export const EMOJI_SETS = 30030

export interface ListContents {
  /** public items (tag arrays, e.g. ["e", id] / ["p", pk] / ["t", topic]) */
  public: string[][]
  /** private items (same shape), kept encrypted to oneself */
  private: string[][]
}

/**
 * Build a list event of the given kind. Private items are NIP-44 self-encrypted
 * into `content`. For a set (30000+), pass a `d` identifier.
 */
export function buildList(
  kind: number,
  contents: ListContents,
  secret: Uint8Array | string,
  selfPubkey: string,
  d?: string,
): EventTemplate {
  const tags = [...contents.public]
  if (d !== undefined) tags.unshift(['d', d])
  const content =
    contents.private.length > 0 ? nip44.encryptTo(JSON.stringify(contents.private), secret, selfPubkey) : ''
  return { kind, content, tags }
}

/** Parse a list. Decrypts private items if a secret (+ self pubkey) is given. */
export function parseList(event: NostrEvent, secret?: Uint8Array | string, selfPubkey?: string): ListContents {
  const pub = event.tags.filter((t) => t[0] !== 'd')
  let priv: string[][] = []
  if (event.content && secret && selfPubkey) {
    const decrypted = nip44.decryptFrom(event.content, secret, selfPubkey)
    priv = JSON.parse(decrypted) as string[][]
  }
  return { public: pub, private: priv }
}

// ── ergonomic bookmark helpers (the most common list) ──

/** Add a bookmark (event id) to a kind-10003 list's public items. */
export function addBookmark(contents: ListContents, eventId: string, isPrivate = false): ListContents {
  const tag = ['e', eventId]
  return isPrivate
    ? { ...contents, private: [...contents.private, tag] }
    : { ...contents, public: [...contents.public, tag] }
}

/** Add a muted pubkey to a kind-10000 mute list. */
export function addMute(contents: ListContents, pubkey: string, isPrivate = true): ListContents {
  const tag = ['p', pubkey]
  return isPrivate
    ? { ...contents, private: [...contents.private, tag] }
    : { ...contents, public: [...contents.public, tag] }
}
