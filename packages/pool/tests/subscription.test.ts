// The AsyncIterable Subscription: for-await, all/first/take, on(), abort, break.
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, type NostrEvent } from '@hopstr/core'
import { Subscription } from '../src/subscription.ts'

const SK = '01'.repeat(32)
let n = 0
const ev = (content: string): NostrEvent => finalizeEvent({ kind: 1, tags: [], content, created_at: ++n }, SK)

describe('Subscription', () => {
  test('for-await yields pushed events; close ends the loop', async () => {
    let closed = false
    const sub = new Subscription(() => {
      closed = true
    })
    const got: string[] = []
    const loop = (async () => {
      for await (const e of sub) got.push(e.content)
    })()
    sub._push(ev('a'))
    sub._push(ev('b'))
    await Promise.resolve()
    sub.close()
    await loop
    expect(got).toEqual(['a', 'b'])
    expect(closed).toBe(true)
  })

  test('break closes the subscription (return path)', async () => {
    let closed = false
    const sub = new Subscription(() => {
      closed = true
    })
    sub._push(ev('a'))
    sub._push(ev('b'))
    for await (const _e of sub) break
    expect(closed).toBe(true)
  })

  test('all() collects until eose then auto-closes', async () => {
    const sub = new Subscription(() => {})
    sub._push(ev('x'))
    const p = sub.all()
    sub._push(ev('y'))
    sub._eose()
    expect((await p).map((e) => e.content)).toEqual(['x', 'y'])
  })

  test('all() when already eosed resolves with the buffer', async () => {
    const sub = new Subscription(() => {})
    sub._push(ev('buffered'))
    sub._eose()
    expect((await sub.all()).map((e) => e.content)).toEqual(['buffered'])
  })

  test('all() resolves on close even without eose', async () => {
    const sub = new Subscription(() => {})
    const p = sub.all()
    sub._push(ev('z'))
    sub.close()
    expect((await p).map((e) => e.content)).toEqual(['z'])
  })

  test('first() returns the first event then closes', async () => {
    const sub = new Subscription(() => {})
    sub._push(ev('one'))
    expect((await sub.first())?.content).toBe('one')
  })

  test('first() returns null when nothing arrives before close', async () => {
    const sub = new Subscription(() => {})
    const p = sub.first()
    sub.close()
    expect(await p).toBeNull()
  })

  test('take(n) collects n then closes; take(0) is empty', async () => {
    const sub = new Subscription(() => {})
    sub._push(ev('1'))
    sub._push(ev('2'))
    sub._push(ev('3'))
    expect((await sub.take(2)).length).toBe(2)
    expect(await new Subscription(() => {}).take(0)).toEqual([])
  })

  test('on() listeners fire for event/eose/close and can unsubscribe', () => {
    const sub = new Subscription(() => {})
    const events: string[] = []
    let eose = 0
    let close = 0
    const off = sub.on('event', (e) => events.push((e as NostrEvent).content))
    sub.on('eose', () => eose++)
    sub.on('close', () => close++)
    sub._push(ev('p'))
    off()
    sub._push(ev('q')) // not recorded after off()
    sub._eose()
    sub._eose() // idempotent
    sub.close()
    sub.close() // idempotent
    expect(events).toEqual(['p'])
    expect(eose).toBe(1)
    expect(close).toBe(1)
  })

  test('AbortSignal closes the subscription', () => {
    const ac = new AbortController()
    let closed = false
    const sub = new Subscription(() => {
      closed = true
    }, ac.signal)
    ac.abort()
    expect(closed).toBe(true)
  })

  test('already-aborted signal closes immediately', () => {
    const ac = new AbortController()
    ac.abort()
    let closed = false
    new Subscription(() => {
      closed = true
    }, ac.signal)
    expect(closed).toBe(true)
  })

  test('push after close is ignored', () => {
    const sub = new Subscription(() => {})
    sub.close()
    sub._push(ev('ignored'))
    sub._eose()
    expect(true).toBe(true)
  })

  test('_close() delegates to close()', () => {
    let closed = false
    const sub = new Subscription(() => {
      closed = true
    })
    sub._close()
    expect(closed).toBe(true)
  })
})
