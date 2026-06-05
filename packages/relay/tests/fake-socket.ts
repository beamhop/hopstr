// A deterministic in-memory WebSocket for testing the Relay FSM without a network.
// Tests drive .open()/.message()/.fail() and inspect .sent frames.
import type { WebSocketLike } from '../src/relay.ts'

export class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = []
  readonly url: string
  sent: unknown[] = []
  closed = false
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.closed = true
    this.onclose?.({})
  }

  // ── test drivers ──
  open(): void {
    this.onopen?.({})
  }
  message(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  rawMessage(data: unknown): void {
    this.onmessage?.({ data })
  }
  serverClose(): void {
    this.onclose?.({})
  }
  error(): void {
    this.onerror?.({})
  }

  static reset(): void {
    FakeSocket.instances = []
  }
  static last(): FakeSocket {
    const s = FakeSocket.instances.at(-1)
    if (!s) throw new Error('no socket created')
    return s
  }
}

/** A WebSocket factory that produces FakeSockets. */
export const fakeFactory = (url: string): FakeSocket => new FakeSocket(url)
