// Nostr client: create, optimistic publish, subscribe/query, profile cache,
// outbox routing — against real in-process relays.
import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildNote,
  finalizeEvent,
  getPublicKey,
  loadIdentity,
  type NostrEvent,
} from '@nostragent/core'
import { privateKeySigner } from '@nostragent/signers'
import { Pool } from '@nostragent/pool'
import { Nostr, DEFAULT_RELAYS } from '../src/client.ts'
import { startRelay, type MockRelay } from './relay-harness.ts'

const SK = '01'.repeat(32)
const PK = getPublicKey(SK)

const relays: MockRelay[] = []
function relay(seed: NostrEvent[] = []): MockRelay {
  const r = startRelay(seed)
  relays.push(r)
  return r
}
afterEach(() => {
  while (relays.length) relays.pop()!.stop()
})

// Build a client whose pool/relays point at our in-process relay(s).
async function client(urls: string[], extra = {}): Promise<Nostr> {
  return Nostr.create({ secretKey: SK, relays: urls, outbox: false, ...extra })
}

describe('create', () => {
  test('random key when none provided', async () => {
    const nostr = await Nostr.create({ relays: [] })
    expect((await nostr.pubkey()).length).toBe(64)
    nostr.close()
  })

  test('from a secret key', async () => {
    const nostr = await client([])
    expect(await nostr.pubkey()).toBe(PK)
    nostr.close()
  })

  test('from a provided signer', async () => {
    const nostr = await Nostr.create({ signer: privateKeySigner(SK), relays: [] })
    expect(await nostr.pubkey()).toBe(PK)
    nostr.close()
  })

  test('default relays are the public set', async () => {
    const nostr = await Nostr.create({ relays: [] })
    expect(DEFAULT_RELAYS.length).toBeGreaterThan(0)
    expect(nostr.relays).toEqual([])
    nostr.close()
  })

  test('read-only client can read but throws on signing', async () => {
    const nostr = await Nostr.create({ readOnly: true, relays: [] })
    expect(() => nostr.signer).toThrow('no signer')
    expect(() => nostr.note('nope')).toThrow('no signer')
    nostr.close()
  })
})

describe('publish', () => {
  test('note() optimistically stores then publishes, returns per-relay results', async () => {
    const r = relay()
    const nostr = await client([r.url])
    const thunk = nostr.note('gm velvet')
    const event = await thunk.event()
    // optimistic: already in the local store before the network resolves
    expect(nostr.store.get(event.id)?.content).toBe('gm velvet')
    const results = await thunk
    expect(results).toEqual([{ relay: r.url, ok: true, reason: '' }])
    expect(r.stored.some((e) => e.id === event.id)).toBe(true)
    nostr.close()
  })

  test('.to() overrides relays', async () => {
    const a = relay()
    const b = relay()
    const nostr = await client([a.url]) // default points at A only
    const results = await nostr.note('to B').to([b.url])
    expect(results.map((x) => x.relay)).toEqual([b.url])
    expect(b.stored.length).toBe(1)
    expect(a.stored.length).toBe(0)
    nostr.close()
  })

  test('.undo() before await prevents the publish', async () => {
    const r = relay()
    const nostr = await client([r.url])
    const thunk = nostr.note('oops')
    const event = await thunk.event()
    thunk.undo()
    const results = await thunk
    expect(results).toEqual([])
    expect(nostr.store.get(event.id)).toBeUndefined() // rolled out of the store
    expect(r.stored.length).toBe(0)
    nostr.close()
  })

  test('.orThrow() rejects when every relay rejects', async () => {
    const r = relay()
    r.rejectAll = true
    const nostr = await client([r.url])
    await expect(nostr.note('blocked').orThrow()).rejects.toThrow('rejected by all relays')
    nostr.close()
  })

  test('.orThrow() returns results when at least one accepts', async () => {
    const r = relay()
    const nostr = await client([r.url])
    const results = await nostr.note('ok').orThrow()
    expect(results.some((x) => x.ok)).toBe(true)
    nostr.close()
  })

  test('.timeout() reports timeout when a relay connects but never answers', async () => {
    const r = relay()
    r.silent = true // accepts the socket, never sends OK
    const nostr = await client([r.url])
    const results = await nostr.note('slow').timeout(50)
    expect(results.every((x) => !x.ok && x.reason === 'timeout')).toBe(true)
    nostr.close()
  })

  test('publish a raw template', async () => {
    const r = relay()
    const nostr = await client([r.url])
    const results = await nostr.publish(buildNote('raw').tag('t', 'x'))
    expect(results[0]!.ok).toBe(true)
    nostr.close()
  })
})

describe('read', () => {
  test('query collects matching events to EOSE', async () => {
    const seed = finalizeEvent({ kind: 1, tags: [], content: 'seeded', created_at: 100 }, SK)
    const r = relay([seed])
    const nostr = await client([r.url])
    const events = await nostr.query({ authors: [PK], kinds: [1] })
    expect(events.some((e) => e.id === seed.id)).toBe(true)
    // mirrored into the store
    expect(nostr.store.get(seed.id)).toBeDefined()
    nostr.close()
  })

  test('notes() defaults to kind 1', async () => {
    const seed = finalizeEvent({ kind: 1, tags: [], content: 'a note', created_at: 100 }, SK)
    const r = relay([seed])
    const nostr = await client([r.url])
    const events = await nostr.notes({ authors: [PK] }).all()
    expect(events.some((e) => e.content === 'a note')).toBe(true)
    nostr.close()
  })

  test('queryOne returns the newest single event or null', async () => {
    const older = finalizeEvent({ kind: 1, tags: [], content: 'old', created_at: 100 }, SK)
    const newer = finalizeEvent({ kind: 1, tags: [], content: 'new', created_at: 200 }, SK)
    const r = relay([older, newer])
    const nostr = await client([r.url])
    const one = await nostr.queryOne({ authors: [PK], kinds: [1] })
    expect(one?.content).toBe('new')
    const none = await nostr.queryOne({ authors: ['ff'.repeat(32)] })
    expect(none).toBeNull()
    nostr.close()
  })

  test('subscribe with an explicit relay override + break', async () => {
    const seed = finalizeEvent({ kind: 1, tags: [], content: 'live', created_at: 100 }, SK)
    const r = relay([seed])
    const unused = relay()
    const nostr = await client([unused.url])
    const seen: string[] = []
    for await (const e of nostr.subscribe({ kinds: [1] }, { relays: [r.url] })) {
      seen.push(e.id)
      break
    }
    expect(seen).toContain(seed.id)
    nostr.close()
  })
})

describe('profiles', () => {
  test('profile() fetches kind-0 and caches it', async () => {
    const profile = finalizeEvent(
      { kind: 0, tags: [], content: '{"name":"velvet"}', created_at: 100 },
      SK,
    )
    const r = relay([profile])
    const nostr = await client([r.url])
    const first = await nostr.profile(PK)
    expect(first?.content).toBe('{"name":"velvet"}')
    // second call is cached: stop the relay, still resolves
    r.stop()
    relays.pop()
    const second = await nostr.profile(PK)
    expect(second?.id).toBe(first!.id)
    nostr.clearProfileCache()
    nostr.close()
  })

  test('profile() returns null when not found', async () => {
    const r = relay()
    const nostr = await client([r.url])
    expect(await nostr.profile('ab'.repeat(32))).toBeNull()
    nostr.close()
  })
})

describe('outbox routing', () => {
  test('reads authors from their NIP-65 write relays', async () => {
    // author's note lives on relayB; their kind-10002 says "write to relayB".
    const note = finalizeEvent({ kind: 1, tags: [], content: 'outboxed', created_at: 100 }, SK)
    const relayB = relay([note])
    const relayList = finalizeEvent(
      { kind: 10002, tags: [['r', relayB.url, 'write']], content: '', created_at: 90 },
      SK,
    )
    const nostr = await Nostr.create({ secretKey: SK, relays: [relayB.url], outbox: true })
    // teach the router about the author's relay list
    nostr.store.add(relayList)
    const events = await nostr.query({ authors: [PK], kinds: [1] })
    expect(events.some((e) => e.id === note.id)).toBe(true)
    nostr.close()
  })

  test('publish routes to the author write relays under outbox', async () => {
    const r = relay()
    const relayList = finalizeEvent(
      { kind: 10002, tags: [['r', r.url, 'write']], content: '', created_at: 90 },
      SK,
    )
    const fallback = relay()
    const nostr = await Nostr.create({ secretKey: SK, relays: [fallback.url], outbox: true })
    nostr.store.add(relayList)
    const results = await nostr.note('routed')
    expect(results.map((x) => x.relay)).toContain(r.url)
    nostr.close()
  })
})
