// A minimal in-process Nostr relay for client integration tests.
import { matchFilters, type Filter, type NostrEvent } from '@hopstr/core'

export interface MockRelay {
  url: string
  stored: NostrEvent[]
  /** make the relay reject all EVENTs (to test publish failure). */
  rejectAll: boolean
  /** accept the socket but never reply to EVENTs (to test publish timeout). */
  silent: boolean
  stop: () => void
}

export function startRelay(seed: NostrEvent[] = []): MockRelay {
  const state: MockRelay = { url: '', stored: [...seed], rejectAll: false, silent: false, stop: () => {} }
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
          if (state.silent) {
            // connect ok, but never acknowledge → exercises the publish timeout
          } else if (state.rejectAll) {
            ws.send(JSON.stringify(['OK', e.id, false, 'blocked: rejecting all']))
          } else {
            state.stored.push(e)
            ws.send(JSON.stringify(['OK', e.id, true, '']))
          }
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
