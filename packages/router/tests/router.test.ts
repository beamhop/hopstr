// Router (weighted set-cover outbox), NIP-65 parsing, hint extraction.
import { describe, expect, test } from 'bun:test'
import {
  finalizeEvent,
  getPublicKey,
  nip19,
  parsePubkey,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'
import { Router, type RouterPolicy } from '../src/router.ts'
import { normalizeRelayUrl, parseRelayList, readRelays, writeRelays } from '../src/nip65.ts'
import { hintsFromPointer, hintsFromTags } from '../src/hints.ts'

const pk = (n: number): Pubkey => parsePubkey(n.toString(16).padStart(64, '0'))

describe('NIP-65 relay lists', () => {
  test('parses read/write markers', () => {
    const ev = finalizeEvent(
      {
        kind: 10002,
        content: '',
        created_at: 1,
        tags: [
          ['r', 'wss://both.example'],
          ['r', 'wss://read.example/', 'read'],
          ['r', 'wss://write.example', 'write'],
          ['x', 'ignored'],
        ],
      },
      '01'.repeat(32),
    )
    const entries = parseRelayList(ev)
    expect(entries).toEqual([
      { url: 'wss://both.example', read: true, write: true },
      { url: 'wss://read.example', read: true, write: false },
      { url: 'wss://write.example', read: false, write: true },
    ])
    expect(writeRelays(entries)).toEqual(['wss://both.example', 'wss://write.example'])
    expect(readRelays(entries)).toEqual(['wss://both.example', 'wss://read.example'])
  })

  test('rejects a non-10002 event', () => {
    const ev = finalizeEvent({ kind: 1, content: '', created_at: 1, tags: [] }, '01'.repeat(32))
    expect(() => parseRelayList(ev)).toThrow('not a kind-10002')
  })

  test('normalizeRelayUrl trims and lowercases host, falls back on garbage', () => {
    expect(normalizeRelayUrl('wss://Relay.Example/')).toBe('wss://relay.example')
    expect(normalizeRelayUrl('wss://relay.example/path/')).toBe('wss://relay.example/path')
    expect(normalizeRelayUrl('not a url///')).toBe('not a url')
  })
})

describe('relay hints', () => {
  test('from e/a/p tag relay positions', () => {
    const ev = finalizeEvent(
      {
        kind: 1,
        content: '',
        created_at: 1,
        tags: [
          ['e', 'ab'.repeat(32), 'wss://hint1.example'],
          ['p', 'cd'.repeat(32), 'wss://hint2.example/'],
          ['a', '30023:x:y', 'wss://hint3.example'],
          ['e', 'ef'.repeat(32)], // no hint
          ['e', 'ef'.repeat(32), 'not-a-relay'], // ignored
        ],
      },
      '01'.repeat(32),
    )
    expect(hintsFromTags(ev).sort()).toEqual(
      ['wss://hint1.example', 'wss://hint2.example', 'wss://hint3.example'].sort(),
    )
  })

  test('from a nevent/nprofile/naddr pointer', () => {
    const author = getPublicKey('01'.repeat(32))
    const nevent = nip19.encodeNevent({ id: 'ab'.repeat(32), relays: ['wss://ptr.example'] })
    expect(hintsFromPointer(nevent)).toEqual(['wss://ptr.example'])
    const nprofile = nip19.encodeNprofile({ pubkey: author, relays: ['wss://p.example'] })
    expect(hintsFromPointer(nprofile)).toEqual(['wss://p.example'])
    expect(hintsFromPointer(nip19.encodeNpub(author))).toEqual([]) // npub carries no relays
    expect(hintsFromPointer('garbage')).toEqual([])
  })
})

describe('Router selection', () => {
  function policy(map: Record<string, string[]>, extra: Partial<RouterPolicy> = {}): RouterPolicy {
    return {
      getPubkeyRelays: (pubkey, _use) => map[pubkey] ?? [],
      getDefaultRelays: () => ['wss://default.example'],
      ...extra,
    }
  }

  test('single author → their relays (capped at limit)', () => {
    const a = pk(1)
    const router = new Router(policy({ [a]: ['wss://a1', 'wss://a2', 'wss://a3', 'wss://a4', 'wss://a5'] }))
    const sel = router.forPubkeys([a])
    expect(sel.length).toBe(1) // one relay already covers the single author
    expect(sel[0]!.pubkeys).toEqual([a])
  })

  test('a shared relay covers many authors in one selection', () => {
    const a = pk(1)
    const b = pk(2)
    const c = pk(3)
    const router = new Router(
      policy({
        [a]: ['wss://shared', 'wss://a-only'],
        [b]: ['wss://shared', 'wss://b-only'],
        [c]: ['wss://shared'],
      }),
    )
    const sel = router.forPubkeys([a, b, c])
    expect(sel.length).toBe(1)
    expect(sel[0]!.relay).toBe('wss://shared')
    expect(sel[0]!.pubkeys.sort()).toEqual([a, b, c].sort())
  })

  test('falls back to default relays for authors with none', () => {
    const a = pk(1)
    const sel = new Router(policy({})).forPubkeys([a])
    expect(sel[0]!.relay).toBe('wss://default.example')
  })

  test('empty input → empty selection', () => {
    expect(new Router(policy({})).forPubkeys([])).toEqual([])
  })

  test('dedups repeated pubkeys', () => {
    const a = pk(1)
    const sel = new Router(policy({ [a]: ['wss://a'] })).forPubkeys([a, a, a])
    expect(sel[0]!.pubkeys).toEqual([a])
  })

  test('respects the relay limit, leaving some authors uncovered', () => {
    const authors = [pk(1), pk(2), pk(3)]
    // each author only reachable on a unique relay → needs 3, but limit is 2
    const map: Record<string, string[]> = {
      [authors[0]!]: ['wss://r1'],
      [authors[1]!]: ['wss://r2'],
      [authors[2]!]: ['wss://r3'],
    }
    const router = new Router(policy(map, { getLimit: () => 2 }))
    const sel = router.forPubkeys(authors)
    expect(sel.length).toBe(2)
  })

  test('quality weighting prefers higher-quality relays', () => {
    const a = pk(1)
    const router = new Router(
      policy({ [a]: ['wss://low', 'wss://high'] }, { getRelayQuality: (u) => (u === 'wss://high' ? 1 : 0.1) }),
    )
    expect(router.forPubkeys([a])[0]!.relay).toBe('wss://high')
  })

  test('publishEvent = author write relays + mentioned read relays', () => {
    const author = pk(1)
    const mentioned = pk(2)
    const router = new Router(
      policy({
        [author]: ['wss://author-write'],
        [mentioned]: ['wss://mention-read'],
      }),
    )
    const relays = router.publishEvent(author, [mentioned])
    expect(relays.sort()).toEqual(['wss://author-write', 'wss://mention-read'].sort())
  })

  test('toPubkeys uses read relays', () => {
    const a = pk(1)
    const reads: string[] = []
    const router = new Router({
      getPubkeyRelays: (_pk, use) => {
        reads.push(use)
        return ['wss://inbox']
      },
      getDefaultRelays: () => [],
    })
    expect(router.toPubkeys([a])[0]!.relay).toBe('wss://inbox')
    expect(reads).toContain('read')
  })
})
