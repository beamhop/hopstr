// In-process Nostr relay for facade regression tests.
import { matchFilters, type Filter, type NostrEvent } from '@hopstr/core'

export interface MockRelay {
  url: string
  stored: NostrEvent[]
  stop: () => void
}

export function startRelay(seed: NostrEvent[] = []): MockRelay {
  const state: MockRelay = { url: '', stored: [...seed], stop: () => {} }
  const sockets = new Set<{ send: (s: string) => void }>()
  const server = Bun.serve({
    port: 0,
    fetch(req, srv) {
      return srv.upgrade(req) ? undefined : new Response('ws only', { status: 426 })
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
      },
      close(ws) {
        sockets.delete(ws)
      },
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as unknown[]
        if (msg[0] === 'EVENT') {
          const e = msg[1] as NostrEvent
          state.stored.push(e)
          ws.send(JSON.stringify(['OK', e.id, true, '']))
        } else if (msg[0] === 'REQ') {
          const id = msg[1] as string
          const filters = msg.slice(2) as Filter[]
          for (const e of state.stored) if (matchFilters(filters, e)) ws.send(JSON.stringify(['EVENT', id, e]))
          ws.send(JSON.stringify(['EOSE', id]))
        }
      },
    },
  })
  state.url = `ws://localhost:${server.port}`
  state.stop = () => server.stop(true)
  return state
}
