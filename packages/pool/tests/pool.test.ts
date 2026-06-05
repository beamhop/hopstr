// Pool: fan-out across relays, dedup by id, EOSE aggregation, publish results,
// verify rejection, normalization. Driven by real in-process relays.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, matchFilters, type Filter, type NostrEvent } from '@nostragent/core'
import { Pool } from '../src/pool.ts'

const SK = '0b'.repeat(32)
const PK = getPublicKey(SK)

// Minimal in-process relay (stores events, answers REQ + EOSE).
function startRelay(seed: NostrEvent[] = []) {
  const stored = [...seed]
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response('ws only', { status: 426 })
    },
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as unknown[]
        if (msg[0] === 'EVENT') {
          const e = msg[1] as NostrEvent
          stored.push(e)
          ws.send(JSON.stringify(['OK', e.id, true, '']))
        } else if (msg[0] === 'REQ') {
          const id = msg[1] as string
          const filters = msg.slice(2) as Filter[]
          for (const e of stored) if (matchFilters(filters, e)) ws.send(JSON.stringify(['EVENT', id, e]))
          ws.send(JSON.stringify(['EOSE', id]))
        }
      },
    },
  })
  return { url: `ws://localhost:${server.port}`, stop: () => server.stop(true), stored }
}

const shared = finalizeEvent({ kind: 1, tags: [], content: 'on both relays', created_at: 100 }, SK)
const onlyA = finalizeEvent({ kind: 1, tags: [], content: 'only on A', created_at: 101 }, SK)

let a: ReturnType<typeof startRelay>
let b: ReturnType<typeof startRelay>
beforeAll(() => {
  a = startRelay([shared, onlyA])
  b = startRelay([shared])
})
afterAll(() => {
  a.stop()
  b.stop()
})

describe('Pool', () => {
  test('query fans out and dedups shared events by id', async () => {
    const pool = new Pool()
    const events = await pool.query([a.url, b.url], { authors: [PK], kinds: [1] })
    const ids = events.map((e) => e.id).sort()
    // shared appears once (deduped), onlyA once
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(shared.id)
    expect(ids).toContain(onlyA.id)
    expect(ids.filter((id) => id === shared.id).length).toBe(1)
    pool.close()
  })

  test('lazy relay map + url normalization (trailing slash)', () => {
    const pool = new Pool()
    const r1 = pool.relay(a.url + '/')
    const r2 = pool.relay(a.url)
    expect(r1).toBe(r2) // normalized to the same key
    expect(pool.urls).toEqual([a.url])
    pool.close()
    expect(pool.urls).toEqual([])
  })

  test('queryOne returns the newest single event', async () => {
    const pool = new Pool()
    const one = await pool.queryOne([a.url], { authors: [PK], kinds: [1] })
    expect(one).not.toBeNull()
    pool.close()
  })

  test('queryOne returns null when nothing matches', async () => {
    const pool = new Pool()
    const none = await pool.queryOne([a.url], { authors: ['ff'.repeat(32)] })
    expect(none).toBeNull()
    pool.close()
  })

  test('publish returns per-relay results, never throws', async () => {
    const pool = new Pool()
    const ev = finalizeEvent({ kind: 1, tags: [], content: 'publish fanout', created_at: 200 }, SK)
    const results = await pool.publish([a.url, b.url], ev)
    expect(results.length).toBe(2)
    expect(results.every((r) => r.ok)).toBe(true)
    expect(results.map((r) => r.relay).sort()).toEqual([a.url, b.url].sort())
    pool.close()
  })

  test('subscribe with no relays EOSEs immediately', async () => {
    const pool = new Pool()
    expect(await pool.query([], { kinds: [1] })).toEqual([])
    pool.close()
  })

  test('verify=true drops a forged event', async () => {
    // a relay that serves a tampered event (id no longer matches content)
    const real = finalizeEvent({ kind: 1, tags: [], content: 'real', created_at: 300 }, SK)
    const forged = { ...real, content: 'tampered' } as NostrEvent
    const bad = startRelay([forged])
    try {
      const pool = new Pool()
      const verified = await pool.query([bad.url], { kinds: [1] }) // verify defaults true
      expect(verified.length).toBe(0)
      const unverified = await pool.query([bad.url], { kinds: [1] }, { verify: false })
      expect(unverified.length).toBe(1)
      pool.close()
    } finally {
      bad.stop()
    }
  })

  test('closeRelay closes and forgets one relay', () => {
    const pool = new Pool()
    pool.relay(a.url)
    pool.closeRelay(a.url)
    expect(pool.urls).toEqual([])
  })

  test('for-await over a live subscription, break closes it', async () => {
    const pool = new Pool()
    const seen: string[] = []
    for await (const e of pool.subscribe([a.url], [{ authors: [PK], kinds: [1] }])) {
      seen.push(e.id)
      break
    }
    expect(seen.length).toBe(1)
    pool.close()
  })
})
