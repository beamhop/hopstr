// NIP-10: threaded replies — e/p tags with root/reply/mention markers.
import type { NostrEvent, Tag } from '@nostragent/core'

export interface ThreadRefs {
  root?: { id: string; relay?: string }
  reply?: { id: string; relay?: string }
  mentions: string[]
  /** all p-tagged pubkeys (thread participants) */
  participants: string[]
}

/** Parse the threading structure out of an event's tags (marked or positional). */
export function parseThread(event: NostrEvent): ThreadRefs {
  const eTags = event.tags.filter((t) => t[0] === 'e' && t[1])
  const refs: ThreadRefs = {
    mentions: [],
    participants: event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!),
  }
  const marked = eTags.filter((t) => t[3] === 'root' || t[3] === 'reply' || t[3] === 'mention')
  if (marked.length > 0) {
    for (const t of eTags) {
      if (t[3] === 'root') refs.root = ref(t)
      else if (t[3] === 'reply') refs.reply = ref(t)
      else if (t[3] === 'mention') refs.mentions.push(t[1]!)
    }
  } else if (eTags.length === 1) {
    // deprecated positional: a single e tag is the reply-to (and root)
    refs.root = ref(eTags[0]!)
  } else if (eTags.length >= 2) {
    refs.root = ref(eTags[0]!)
    refs.reply = ref(eTags[eTags.length - 1]!)
    for (let i = 1; i < eTags.length - 1; i++) refs.mentions.push(eTags[i]![1]!)
  }
  return refs
}

function ref(tag: Tag): { id: string; relay?: string } {
  return tag[2] ? { id: tag[1]!, relay: tag[2] } : { id: tag[1]! }
}

/** Build NIP-10 reply tags (marked form) to reply to `parent`. */
export function replyTags(parent: Pick<NostrEvent, 'id' | 'pubkey' | 'tags'>, relay = ''): Tag[] {
  const parentThread = parseThread(parent as NostrEvent)
  const tags: Tag[] = []
  const root = parentThread.root
  if (root) {
    tags.push(['e', root.id, root.relay ?? relay, 'root'])
    tags.push(['e', parent.id, relay, 'reply'])
  } else {
    tags.push(['e', parent.id, relay, 'root'])
  }
  // include the parent author + carried participants as p tags (dedup)
  const pubkeys = new Set<string>([parent.pubkey, ...parentThread.participants])
  for (const pk of pubkeys) tags.push(['p', pk])
  return tags
}
