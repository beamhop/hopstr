// EventStore: dedup, replaceable/addressable newest-wins, NIP-09, NIP-40, streams.
import { describe, expect, test } from 'bun:test'
import { addressOf, finalizeEvent, getPublicKey, type NostrEvent } from '@nostragent/core'
import { EventStore } from '../src/store.ts'

const SK = '01'.repeat(32)
const SK2 = '02'.repeat(31) + '03'
const PK = getPublicKey(SK)

function mk(opts: { kind?: number; content?: string; created_at?: number; tags?: string[][]; sk?: string }): NostrEvent {
  return finalizeEvent(
    {
      kind: opts.kind ?? 1,
      content: opts.content ?? '',
      created_at: opts.created_at ?? 1000,
      tags: opts.tags ?? [],
    },
    opts.sk ?? SK,
  )
}

describe('basic add/get/query', () => {
  test('adds and dedups by id', () => {
    const store = new EventStore()
    const e = mk({ content: 'hi' })
    expect(store.add(e)).toBe('added')
    expect(store.add(e)).toBe('duplicate')
    expect(store.get(e.id)?.content).toBe('hi')
    expect(store.size).toBe(1)
  })

  test('query matches filters, newest first', () => {
    const store = new EventStore()
    const a = mk({ content: 'old', created_at: 100 })
    const b = mk({ content: 'new', created_at: 200 })
    store.add(a)
    store.add(b)
    const result = store.query([{ authors: [PK], kinds: [1] }])
    expect(result.map((e) => e.content)).toEqual(['new', 'old'])
    expect(store.query([{ kinds: [7] }])).toEqual([])
  })

  test('get returns undefined for unknown id', () => {
    expect(new EventStore().get('ff'.repeat(32))).toBeUndefined()
  })
})

describe('replaceable (kind 0/3/1xxxx)', () => {
  test('newest wins, older is outdated, coordinate resolves', () => {
    const store = new EventStore()
    const older = mk({ kind: 0, content: '{"name":"v1"}', created_at: 100 })
    const newer = mk({ kind: 0, content: '{"name":"v2"}', created_at: 200 })
    expect(store.add(older)).toBe('added')
    expect(store.add(newer)).toBe('replaced')
    expect(store.add(mk({ kind: 0, content: 'stale', created_at: 50 }))).toBe('outdated')
    expect(store.size).toBe(1)
    expect(store.getReplaceable(addressOf(newer))?.content).toBe('{"name":"v2"}')
  })

  test('equal timestamp tie-break by lower id', () => {
    const store = new EventStore()
    const a = mk({ kind: 0, content: 'A', created_at: 100 })
    const b = mk({ kind: 0, content: 'B', created_at: 100 })
    store.add(a)
    store.add(b)
    // whichever id is lower must be the survivor
    const lower = a.id < b.id ? a : b
    expect(store.getReplaceable(addressOf(a))?.id).toBe(lower.id)
  })

  test('per-author coordinates are independent', () => {
    const store = new EventStore()
    store.add(mk({ kind: 0, content: 'mine', created_at: 100 }))
    store.add(mk({ kind: 0, content: 'theirs', created_at: 100, sk: SK2 }))
    expect(store.size).toBe(2)
  })
})

describe('addressable (kind 3xxxx)', () => {
  test('newest per kind:pubkey:d', () => {
    const store = new EventStore()
    const v1 = mk({ kind: 30023, content: 'draft', created_at: 100, tags: [['d', 'post']] })
    const v2 = mk({ kind: 30023, content: 'final', created_at: 200, tags: [['d', 'post']] })
    const other = mk({ kind: 30023, content: 'other', created_at: 100, tags: [['d', 'other']] })
    store.add(v1)
    store.add(v2)
    store.add(other)
    expect(store.size).toBe(2) // post (final) + other
    expect(store.getReplaceable('30023:' + PK + ':post')?.content).toBe('final')
  })
})

describe('NIP-09 deletion', () => {
  test('deletes a referenced event by the same author', () => {
    const store = new EventStore()
    const note = mk({ content: 'delete me', created_at: 100 })
    store.add(note)
    expect(store.size).toBe(1)
    const del = mk({ kind: 5, tags: [['e', note.id]], created_at: 200 })
    expect(store.add(del)).toBe('added')
    expect(store.get(note.id)).toBeUndefined()
    // re-adding the tombstoned event is rejected
    expect(store.add(note)).toBe('deleted')
  })

  test('ignores a deletion from a different author', () => {
    const store = new EventStore()
    const note = mk({ content: 'mine', created_at: 100 })
    store.add(note)
    const del = mk({ kind: 5, tags: [['e', note.id]], created_at: 200, sk: SK2 })
    store.add(del)
    // the event itself isn't removed (wrong author), though the id is tombstoned
    expect(store.get(note.id)?.content).toBe('mine')
  })

  test('deletes an addressable coordinate via a-tag', () => {
    const store = new EventStore()
    const article = mk({ kind: 30023, content: 'post', created_at: 100, tags: [['d', 'slug']] })
    store.add(article)
    const coord = '30023:' + PK + ':slug'
    const del = mk({ kind: 5, tags: [['a', coord]], created_at: 200 })
    store.add(del)
    expect(store.getReplaceable(coord)).toBeUndefined()
  })

  test('deletion with no matching target is harmless', () => {
    const store = new EventStore()
    expect(store.add(mk({ kind: 5, tags: [['e', 'ab'.repeat(32)], ['a', '1:x:y']], created_at: 1 }))).toBe('added')
  })
})

describe('NIP-40 expiry', () => {
  test('rejects an already-expired event', () => {
    const store = new EventStore({ now: () => 1000 })
    const expired = mk({ content: 'gone', created_at: 100, tags: [['expiration', '500']] })
    expect(store.add(expired)).toBe('expired')
    expect(store.size).toBe(0)
  })

  test('keeps a not-yet-expired event, drops it once time passes', () => {
    let clock = 1000
    const store = new EventStore({ now: () => clock })
    const e = mk({ content: 'ttl', created_at: 100, tags: [['expiration', '2000']] })
    expect(store.add(e)).toBe('added')
    expect(store.get(e.id)?.content).toBe('ttl')
    clock = 3000
    expect(store.get(e.id)).toBeUndefined() // expired on read
    expect(store.query([{ kinds: [1] }])).toEqual([]) // and excluded from queries
  })

  test('ignores a malformed expiration tag', () => {
    const store = new EventStore({ now: () => 1000 })
    expect(store.add(mk({ content: 'x', tags: [['expiration', 'soon']] }))).toBe('added')
  })
})

describe('reactivity', () => {
  test('onEvent fires for accepted events and unsubscribes', () => {
    const store = new EventStore()
    const seen: string[] = []
    const off = store.onEvent((e) => seen.push(e.content))
    store.add(mk({ content: 'a', created_at: 1 }))
    off()
    store.add(mk({ content: 'b', created_at: 2 }))
    expect(seen).toEqual(['a'])
  })

  test('stream replays current matches then yields new ones; abort stops it', async () => {
    const store = new EventStore()
    store.add(mk({ content: 'existing', created_at: 1 }))
    const ac = new AbortController()
    const got: string[] = []
    // Resolve once the replayed 'existing' has been consumed, so we add the live
    // event only after the generator is parked — deterministic under any load.
    let replayed!: () => void
    const afterReplay = new Promise<void>((r) => (replayed = r))
    const consume = (async () => {
      for await (const e of store.stream([{ kinds: [1] }], ac.signal)) {
        got.push(e.content)
        if (e.content === 'existing') replayed()
        if (got.length === 2) ac.abort()
      }
    })()
    await afterReplay
    // one more microtask turn so the generator reaches its park point
    await Promise.resolve()
    store.add(mk({ content: 'live', created_at: 2 }))
    await consume
    expect(got).toEqual(['existing', 'live'])
  })

  test('stream returns immediately if the signal is already aborted', async () => {
    const store = new EventStore()
    store.add(mk({ content: 'x', created_at: 1 }))
    const ac = new AbortController()
    ac.abort()
    const got: string[] = []
    for await (const e of store.stream([{ kinds: [1] }], ac.signal)) got.push(e.content)
    // it replays the existing match then returns at the aborted check
    expect(got).toEqual(['x'])
  })
})
