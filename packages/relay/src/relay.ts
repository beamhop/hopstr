// A single resilient connection to one relay: connect/reconnect with backoff,
// subscriptions that survive reconnects, publish with OK tracking, NIP-42 auth.
//
// WebSocket and the clock are injectable so reconnection/backoff/timeout logic
// is fully testable with fake timers and an in-process mock socket.
import type { Filter, NostrEvent } from '@nostragent/core'
import {
  parseRelayMessage,
  reasonPrefix,
  serializeClientMessage,
  type RelayMessage,
} from './messages.ts'

/** Minimal WebSocket surface we depend on (browser/Bun/ws all satisfy it). */
export interface WebSocketLike {
  send(data: string): void
  close(): void
  onopen: ((ev: unknown) => void) | null
  onclose: ((ev: unknown) => void) | null
  onerror: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}
export type WebSocketFactory = (url: string) => WebSocketLike

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'closed'

export interface RelayOptions {
  /** Inject a WebSocket constructor; defaults to globalThis.WebSocket. */
  WebSocket?: WebSocketFactory
  /** Inject time for deterministic backoff/timeout tests. Default Date.now. */
  now?: () => number
  /** Inject scheduling; defaults to setTimeout/clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  /** Sign an AUTH (kind 22242) challenge when the relay requires it (NIP-42). */
  auth?: (challenge: string) => Promise<NostrEvent>
  /** Reconnect backoff bounds (ms). */
  minBackoff?: number
  maxBackoff?: number
  /** ms to wait for an OK after publishing before giving up. */
  publishTimeout?: number
}

export interface SubscribeHandlers {
  onEvent: (event: NostrEvent) => void
  onEose?: () => void
  onClosed?: (reason: string) => void
}

export interface PublishResult {
  ok: boolean
  reason: string
}

interface ActiveSub {
  filters: Filter[]
  handlers: SubscribeHandlers
  eosed: boolean
}

interface ResolvedRelayOptions {
  WebSocket: WebSocketFactory
  now: () => number
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void
  minBackoff: number
  maxBackoff: number
  publishTimeout: number
  auth?: (challenge: string) => Promise<NostrEvent>
}

let subCounter = 0

export class Relay {
  readonly url: string
  #opts: ResolvedRelayOptions
  #ws: WebSocketLike | undefined
  #state: ConnectionState = 'idle'
  #subs = new Map<string, ActiveSub>()
  #pendingPublish = new Map<string, { resolve: (r: PublishResult) => void; timer: ReturnType<typeof setTimeout> }>()
  #outbox: string[] = []
  #failures = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined
  #challenge: string | undefined
  #authedFor = new Set<string>() // challenges we've answered
  #wantOpen = false

  constructor(url: string, options: RelayOptions = {}) {
    this.url = url
    const globalWs = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket
    const WS = options.WebSocket ?? (globalWs ? (url: string) => new globalWs(url) : undefined)
    if (!WS) throw new Error('no WebSocket available; pass options.WebSocket')
    this.#opts = {
      WebSocket: WS,
      now: options.now ?? Date.now,
      setTimer: options.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: options.clearTimer ?? ((h) => clearTimeout(h)),
      minBackoff: options.minBackoff ?? 1000,
      maxBackoff: options.maxBackoff ?? 30_000,
      publishTimeout: options.publishTimeout ?? 10_000,
      ...(options.auth ? { auth: options.auth } : {}),
    }
  }

  get state(): ConnectionState {
    return this.#state
  }

  /** Open the socket (idempotent). Resolves once the socket is open. */
  connect(): Promise<void> {
    this.#wantOpen = true
    if (this.#state === 'open') return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.#openOnce(resolve, reject)
    })
  }

  #openOnce(resolve?: () => void, reject?: (e: Error) => void): void {
    if (this.#state === 'connecting' || this.#state === 'open') {
      resolve?.()
      return
    }
    this.#state = 'connecting'
    const ws = this.#opts.WebSocket(this.url)
    this.#ws = ws
    ws.onopen = () => {
      this.#state = 'open'
      this.#failures = 0
      // replay subscriptions + flush queued messages
      for (const [id, sub] of this.#subs) {
        sub.eosed = false
        this.#send(['REQ', id, ...sub.filters])
      }
      const queued = this.#outbox.splice(0)
      for (const m of queued) ws.send(m)
      resolve?.()
    }
    ws.onmessage = (ev) => this.#onMessage(ev.data)
    ws.onerror = () => {
      // surface as a close; the close handler drives reconnect
    }
    ws.onclose = () => {
      const wasConnecting = this.#state === 'connecting'
      this.#state = 'closed'
      this.#ws = undefined
      if (this.#wantOpen) this.#scheduleReconnect()
      if (wasConnecting) reject?.(new Error(`failed to connect to ${this.url}`))
    }
  }

  #scheduleReconnect(): void {
    if (this.#reconnectTimer) return
    this.#failures++
    const delay = Math.min(this.#opts.minBackoff * 2 ** (this.#failures - 1), this.#opts.maxBackoff)
    this.#reconnectTimer = this.#opts.setTimer(() => {
      this.#reconnectTimer = undefined
      if (this.#wantOpen) this.#openOnce()
    }, delay)
  }

  /** Subscribe with raw filters. Returns an unsubscribe function (sends CLOSE). */
  subscribe(filters: Filter[], handlers: SubscribeHandlers): () => void {
    const id = `velvet-${subCounter++}`
    this.#subs.set(id, { filters, handlers, eosed: false })
    if (this.#state === 'open') this.#send(['REQ', id, ...filters])
    else void this.connect()
    return () => {
      this.#subs.delete(id)
      if (this.#state === 'open') this.#send(['CLOSE', id])
    }
  }

  /** Publish an event; resolves with the relay's OK (or a timeout failure). */
  publish(event: NostrEvent): Promise<PublishResult> {
    return new Promise((resolve) => {
      const timer = this.#opts.setTimer(() => {
        this.#pendingPublish.delete(event.id)
        resolve({ ok: false, reason: 'timeout' })
      }, this.#opts.publishTimeout)
      this.#pendingPublish.set(event.id, { resolve, timer })
      this.#send(['EVENT', event])
      void this.connect()
    })
  }

  /** Send a one-shot COUNT (NIP-45); resolves the count or rejects on CLOSED. */
  close(): void {
    this.#wantOpen = false
    if (this.#reconnectTimer) {
      this.#opts.clearTimer(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }
    for (const [, p] of this.#pendingPublish) {
      this.#opts.clearTimer(p.timer)
      p.resolve({ ok: false, reason: 'relay closed' })
    }
    this.#pendingPublish.clear()
    this.#subs.clear()
    this.#ws?.close()
    this.#ws = undefined
    this.#state = 'closed'
  }

  #send(message: Parameters<typeof serializeClientMessage>[0]): void {
    const json = serializeClientMessage(message)
    if (this.#state === 'open' && this.#ws) this.#ws.send(json)
    else this.#outbox.push(json)
  }

  #onMessage(data: unknown): void {
    let parsed: unknown
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : data
    } catch {
      return
    }
    const msg = parseRelayMessage(parsed)
    if (!msg) return
    this.#dispatch(msg)
  }

  #dispatch(msg: RelayMessage): void {
    switch (msg.type) {
      case 'EVENT':
        this.#subs.get(msg.sub)?.handlers.onEvent(msg.event)
        return
      case 'EOSE': {
        const sub = this.#subs.get(msg.sub)
        if (sub && !sub.eosed) {
          sub.eosed = true
          sub.handlers.onEose?.()
        }
        return
      }
      case 'CLOSED': {
        const sub = this.#subs.get(msg.sub)
        // a relay can close a sub for auth; try to authenticate and resubscribe
        if (reasonPrefix(msg.reason) === 'auth-required') void this.#tryAuth()
        sub?.handlers.onClosed?.(msg.reason)
        return
      }
      case 'OK': {
        const pending = this.#pendingPublish.get(msg.id)
        if (pending) {
          this.#opts.clearTimer(pending.timer)
          this.#pendingPublish.delete(msg.id)
          pending.resolve({ ok: msg.ok, reason: msg.reason })
        }
        if (!msg.ok && reasonPrefix(msg.reason) === 'auth-required') void this.#tryAuth()
        return
      }
      case 'AUTH':
        this.#challenge = msg.challenge
        void this.#tryAuth()
        return
      case 'NOTICE':
      case 'COUNT':
        return
    }
  }

  async #tryAuth(): Promise<void> {
    if (!this.#opts.auth || !this.#challenge || this.#authedFor.has(this.#challenge)) return
    const challenge = this.#challenge
    this.#authedFor.add(challenge)
    const event = await this.#opts.auth(challenge)
    this.#send(['AUTH', event])
  }
}

/** Build the canonical NIP-42 AUTH event template for a challenge. */
export function buildAuthTemplate(relayUrl: string, challenge: string): { kind: number; tags: string[][]; content: string } {
  return { kind: 22242, tags: [['relay', relayUrl], ['challenge', challenge]], content: '' }
}
