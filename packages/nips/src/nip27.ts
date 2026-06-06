// NIP-27: inline `nostr:` mentions inside content, with matching tags.
import { nip19, nip21 } from '@hopstr/core'

const NOSTR_URI = /nostr:(npub1|nprofile1|note1|nevent1|naddr1)[0-9a-z]+/g

export interface InlineRef {
  uri: string
  entity: string
  decoded: ReturnType<typeof nip19.decode>
}

/** Find every `nostr:` reference in a piece of content. */
export function findReferences(content: string): InlineRef[] {
  const refs: InlineRef[] = []
  for (const match of content.matchAll(NOSTR_URI)) {
    const uri = match[0]
    const entity = nip21.toEntity(uri)
    try {
      refs.push({ uri, entity, decoded: nip19.decode(entity) })
    } catch {
      // skip an unparseable reference
    }
  }
  return refs
}

/**
 * Derive the e/p/a tags a note should carry for its inline references, so
 * mentioned users/events get notified (NIP-27 + NIP-10).
 */
export function referenceTags(content: string): string[][] {
  const tags: string[][] = []
  const seen = new Set<string>()
  for (const ref of findReferences(content)) {
    const d = ref.decoded
    const add = (tag: string[]) => {
      const key = tag.join(':')
      if (!seen.has(key)) {
        seen.add(key)
        tags.push(tag)
      }
    }
    if (d.type === 'npub') add(['p', d.data])
    else if (d.type === 'nprofile') add(['p', d.data.pubkey])
    else if (d.type === 'note') add(['e', d.data])
    else if (d.type === 'nevent') add(['e', d.data.id])
    else if (d.type === 'naddr') add(['a', `${d.data.kind}:${d.data.pubkey}:${d.data.identifier}`])
  }
  return tags
}
