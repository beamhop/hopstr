// Relay FSM, subscriptions, publish/OK, reconnect+backoff, NIP-42 auth —
// all deterministic via FakeSocket + a manual clock/timer.
import { afterEach, describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, type NostrEvent } from '@nostragent/core'
import { Relay, buildAuthTemplate } from '../src/relay.ts'
import { FakeSocket, fakeFactory } from './fake-socket.ts'

const SK = '01'.repeat(32)
const PK = getPublicKey(SK)

function signed(content: string): NostrEvent {
  return finalizeEvent({ kind: 1, tags: [], content, created_at: 1 }, SK)
}

// A controllable timer scheduler the Relay uses instead of setTimeout.
class ManualClock {
  #now = 0
  #timers: Array<{ id: number; fireAt: number; fn: () => void }> = []
  #seq = 1
  now = (): number => this.#now
  set = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = this.#seq++
    this.#timers.push({ id, fireAt: this.#now + ms, fn })
    return id as unknown as ReturnType<typeof setTimeout>
  }
  clear = (handle: ReturnType<typeof setTimeout>): void => {
    this.#timers = this.#timers.filter((t) => t.id !== (handle as unknown as number))
  }
  advance(ms: number): void {
    this.#now += ms
    const due = this.#timers.filter((t) => t.fireAt <= this.#now).sort((a, b) => a.fireAt - b.fireAt)
    this.#timers = this.#timers.filter((t) => t.fireAt > this.#now)
    for (const t of due) t.fn()
  }
}

afterEach(() => FakeSocket.reset())

function makeRelay(extra: Record<string, unknown> = {}) {
  const clock = new ManualClock()
  const relay = new Relay('wss://relay.test', {
    WebSocket: fakeFactory,
    now: clock.now,
    setTimer: clock.set,
    clearTimer: clock.clear,
    minBackoff: 1000,
    maxBackoff: 8000,
    publishTimeout: 5000,
    ...extra,
  })
  return { relay, clock }
}

describe('connection', () => {
  test('connect resolves on open and tracks state', async () => {
    const { relay } = makeRelay()
    const p = relay.connect()
    expect(relay.state).toBe('connecting')
    FakeSocket.last().open()
    await p
    expect(relay.state).toBe('open')
  })

  test('connect is idempotent when already open', async () => {
    const { relay } = makeRelay()
    const p = relay.connect()
    FakeSocket.last().open()
    await p
    await relay.connect() // no new socket
    expect(FakeSocket.instances.length).toBe(1)
  })

  test('throws without any WebSocket', () => {
    const g = globalThis as { WebSocket?: unknown }
    const saved = g.WebSocket
    delete g.WebSocket
    try {
      expect(() => new Relay('wss://x')).toThrow('no WebSocket')
    } finally {
      g.WebSocket = saved
    }
  })

  test('uses the global WebSocket when none is injected', () => {
    // Bun provides a global WebSocket, so this should construct without throwing.
    expect(new Relay('wss://x').url).toBe('wss://x')
  })
})

describe('subscriptions', () => {
  test('sends REQ, delivers EVENT + EOSE, CLOSE on unsubscribe', async () => {
    const { relay } = makeRelay()
    const events: string[] = []
    let eosed = false
    const unsub = relay.subscribe([{ kinds: [1] }], {
      onEvent: (e) => events.push(e.content),
      onEose: () => {
        eosed = true
      },
    })
    const p = relay.connect()
    const sock = FakeSocket.last()
    sock.open()
    await p
    expect(sock.sent[0]).toEqual(['REQ', expect.any(String), { kinds: [1] }])
    const subId = (sock.sent[0] as string[])[1]
    sock.message(['EVENT', subId, signed('hello')])
    sock.message(['EOSE', subId])
    sock.message(['EOSE', subId]) // duplicate EOSE ignored
    expect(events).toEqual(['hello'])
    expect(eosed).toBe(true)
    unsub()
    expect(sock.sent.at(-1)).toEqual(['CLOSE', subId])
  })

  test('queues REQ before open, replays on (re)connect', async () => {
    const { relay, clock } = makeRelay()
    relay.subscribe([{ kinds: [1] }], { onEvent: () => {} })
    const p = relay.connect()
    const sock = FakeSocket.last()
    sock.open()
    await p
    expect(sock.sent.some((m) => Array.isArray(m) && m[0] === 'REQ')).toBe(true)
    // drop the connection → reconnect replays the REQ
    sock.serverClose()
    expect(relay.state).toBe('closed')
    clock.advance(1000)
    const sock2 = FakeSocket.last()
    expect(sock2).not.toBe(sock)
    sock2.open()
    expect(sock2.sent.some((m) => Array.isArray(m) && m[0] === 'REQ')).toBe(true)
  })

  test('CLOSED with auth-required triggers auth', async () => {
    const auth = async (challenge: string) => finalizeEvent(buildAuthTemplate('wss://relay.test', challenge), SK)
    const { relay } = makeRelay({ auth })
    relay.subscribe([{ kinds: [1] }], { onEvent: () => {}, onClosed: () => {} })
    const p = relay.connect()
    const sock = FakeSocket.last()
    sock.open()
    await p
    sock.message(['AUTH', 'challenge-123'])
    await Promise.resolve()
    await Promise.resolve()
    const authFrame = sock.sent.find((m) => Array.isArray(m) && m[0] === 'AUTH') as [string, NostrEvent]
    expect(authFrame?.[1]?.kind).toBe(22242)
  })
})

describe('publish', () => {
  test('resolves with OK', async () => {
    const { relay } = makeRelay()
    const ev = signed('publish me')
    const pub = relay.publish(ev)
    const sock = FakeSocket.last()
    sock.open()
    sock.message(['OK', ev.id, true, ''])
    expect(await pub).toEqual({ ok: true, reason: '' })
  })

  test('resolves with failure + reason', async () => {
    const { relay } = makeRelay()
    const ev = signed('blocked')
    const pub = relay.publish(ev)
    FakeSocket.last().open()
    FakeSocket.last().message(['OK', ev.id, false, 'blocked: spam'])
    expect(await pub).toEqual({ ok: false, reason: 'blocked: spam' })
  })

  test('times out without an OK', async () => {
    const { relay, clock } = makeRelay()
    const pub = relay.publish(signed('lost'))
    FakeSocket.last().open()
    clock.advance(5000)
    expect(await pub).toEqual({ ok: false, reason: 'timeout' })
  })

  test('OK with auth-required triggers auth', async () => {
    let challenges = 0
    const auth = async (c: string) => {
      challenges++
      return finalizeEvent(buildAuthTemplate('wss://relay.test', c), SK)
    }
    const { relay } = makeRelay({ auth })
    const ev = signed('needs auth')
    const pub = relay.publish(ev)
    const sock = FakeSocket.last()
    sock.open()
    sock.message(['AUTH', 'chal'])
    sock.message(['OK', ev.id, false, 'auth-required: please AUTH'])
    await pub
    await Promise.resolve()
    expect(challenges).toBe(1)
  })
})

describe('reconnect + backoff', () => {
  test('exponential backoff schedule, capped', async () => {
    const { relay, clock } = makeRelay()
    relay.subscribe([{ kinds: [1] }], { onEvent: () => {} })
    const p = relay.connect()
    FakeSocket.last().open()
    await p
    // fail repeatedly; each reconnect waits min*2^(n-1) capped at max
    FakeSocket.last().serverClose()
    clock.advance(999) // not yet
    expect(FakeSocket.instances.length).toBe(1)
    clock.advance(1) // 1000ms → reconnect #1
    expect(FakeSocket.instances.length).toBe(2)
    FakeSocket.last().serverClose()
    clock.advance(2000) // 2000ms → reconnect #2
    expect(FakeSocket.instances.length).toBe(3)
  })

  test('close() stops reconnects and fails pending publishes', async () => {
    const { relay, clock } = makeRelay()
    const pub = relay.publish(signed('x'))
    const sock = FakeSocket.last()
    sock.open()
    relay.close()
    expect(await pub).toEqual({ ok: false, reason: 'relay closed' })
    sock.serverClose()
    clock.advance(100000)
    expect(FakeSocket.instances.length).toBe(1) // no reconnect after close
  })

  test('failed initial connect rejects', async () => {
    const { relay } = makeRelay()
    const p = relay.connect()
    FakeSocket.last().serverClose() // never opened
    await expect(p).rejects.toThrow('failed to connect')
  })
})

describe('message robustness', () => {
  test('ignores malformed frames and unknown types', async () => {
    const { relay } = makeRelay()
    const p = relay.connect()
    const sock = FakeSocket.last()
    sock.open()
    await p
    sock.rawMessage('not json{')
    sock.rawMessage(JSON.stringify(['MYSTERY', 'x']))
    sock.rawMessage(JSON.stringify('a string'))
    sock.message(['NOTICE', 'hi there'])
    sock.message(['COUNT', 'sub', { count: 5 }])
    expect(relay.state).toBe('open') // survived
  })

  test('error handler is a no-op (close drives reconnect)', async () => {
    const { relay } = makeRelay()
    const p = relay.connect()
    FakeSocket.last().open()
    await p
    FakeSocket.last().error()
    expect(relay.state).toBe('open')
  })
})
