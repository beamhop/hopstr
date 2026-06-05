// Integration: a real in-process relay over Bun.serve, driving the Relay with
// the actual global WebSocket (no FakeSocket). Exercises the live socket path.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, matchFilters, type Filter, type NostrEvent } from '@nostragent/core'
import { Relay } from '../src/relay.ts'

const SK = '0a'.repeat(32)

interface Sub {
  id: string
  filters: Filter[]
}

// A minimal but real Nostr relay: stores events, answers REQ with matches+EOSE.
function startMockRelay() {
  const stored: NostrEvent[] = []
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined
      return new Response('expected websocket', { status: 426 })
    },
    websocket: {
      message(ws, raw) {
        let msg: unknown[]
        try {
          msg = JSON.parse(String(raw))
        } catch {
          return
        }
        const [kind] = msg
        if (kind === 'EVENT') {
          const event = msg[1] as NostrEvent
          stored.push(event)
          ws.send(JSON.stringify(['OK', event.id, true, '']))
        } else if (kind === 'REQ') {
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

let mock: ReturnType<typeof startMockRelay>
beforeAll(() => {
  mock = startMockRelay()
})
afterAll(() => mock.stop())

describe('Relay against a real in-process relay', () => {
  test('publish → subscribe-back → EOSE round-trip', async () => {
    const relay = new Relay(mock.url) // uses the global WebSocket
    await relay.connect()
    expect(relay.state).toBe('open')

    const event = finalizeEvent({ kind: 1, tags: [['t', 'velvet']], content: 'real socket gm' }, SK)
    const result = await relay.publish(event)
    expect(result.ok).toBe(true)

    const received: NostrEvent[] = []
    const eose = new Promise<void>((resolve) => {
      relay.subscribe([{ authors: [getPublicKey(SK)], kinds: [1] }], {
        onEvent: (e) => received.push(e),
        onEose: () => resolve(),
      })
    })
    await eose
    expect(received.some((e) => e.id === event.id)).toBe(true)
    relay.close()
  })
})
