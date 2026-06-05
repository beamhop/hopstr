// NIP-46: remote signing over relays ("bunker"). The client holds a disposable
// local key and talks JSON-RPC (kind 24133, NIP-44 encrypted) to a remote signer.
//
// Transport is injected (publish + subscribe over relays) so this is testable
// without a live relay; @nostragent/client wires in the real pool in Phase 5.
import {
  finalizeEvent,
  getPublicKey,
  nip44,
  parsePubkey,
  type EventTemplate,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'
import type { Signer } from './signer.ts'

const KIND = 24133

/** Minimal relay transport the bunker needs. */
export interface Nip46Transport {
  /** Publish a signed event to the signer's relays. */
  publish(event: NostrEvent, relays: string[]): Promise<void>
  /**
   * Subscribe to kind-24133 responses addressed to `clientPubkey`. Calls `onEvent`
   * per matching event; returns an unsubscribe function.
   */
  subscribe(clientPubkey: Pubkey, relays: string[], onEvent: (e: NostrEvent) => void): () => void
}

interface BunkerPointer {
  signerPubkey: Pubkey
  relays: string[]
  secret?: string
}

/** Parse a `bunker://<pubkey>?relay=..&secret=..` URI. */
export function parseBunkerUri(uri: string): BunkerPointer {
  if (!uri.startsWith('bunker://')) throw new Error('expected a bunker:// URI')
  const url = new URL(uri)
  const signerPubkey = parsePubkey(url.hostname || url.pathname.replace(/^\/+/, ''))
  const relays = url.searchParams.getAll('relay')
  if (relays.length === 0) throw new Error('bunker URI has no relay')
  const secret = url.searchParams.get('secret') ?? undefined
  return secret ? { signerPubkey, relays, secret } : { signerPubkey, relays }
}

interface Rpc {
  id: string
  method: string
  params: string[]
}
interface RpcResponse {
  id: string
  result?: string
  error?: string
}

export interface BunkerOptions {
  /** The disposable local secret used to talk to the signer (hex or bytes). */
  clientSecret: Uint8Array | string
  transport: Nip46Transport
  /** ms before a request rejects. Default 30s (a human may need to approve). */
  timeout?: number
  /** Called when the signer asks the user to authenticate at a URL. */
  onAuthUrl?: (url: string) => void
  /** Inject a unique-id generator (tests pass a deterministic one). */
  genId?: () => string
}

interface ResolvedOptions {
  clientSecret: Uint8Array | string
  transport: Nip46Transport
  timeout: number
  genId: () => string
  onAuthUrl?: (url: string) => void
}

export class BunkerSigner implements Signer {
  readonly backend = 'nip46' as const
  #pointer: BunkerPointer
  #opts: ResolvedOptions
  #clientPubkey: Pubkey
  #pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  #unsub?: () => void
  #userPubkey?: Pubkey
  #counter = 0

  constructor(pointer: BunkerPointer, opts: BunkerOptions) {
    this.#pointer = pointer
    this.#opts = {
      clientSecret: opts.clientSecret,
      transport: opts.transport,
      timeout: opts.timeout ?? 30_000,
      genId: opts.genId ?? (() => `${Date.now()}-${this.#counter++}`),
      ...(opts.onAuthUrl ? { onAuthUrl: opts.onAuthUrl } : {}),
    }
    this.#clientPubkey = getPublicKey(opts.clientSecret)
  }

  /** Start listening for responses and send `connect`. */
  async connect(): Promise<void> {
    this.#unsub = this.#opts.transport.subscribe(this.#clientPubkey, this.#pointer.relays, (e) =>
      this.#onResponse(e),
    )
    const params = this.#pointer.secret ? [this.#pointer.signerPubkey, this.#pointer.secret] : [this.#pointer.signerPubkey]
    const ack = await this.#request('connect', params)
    if (ack !== 'ack' && ack !== this.#pointer.secret) throw new Error(`unexpected connect result: ${ack}`)
  }

  /** Stop listening and reject anything outstanding. */
  close(): void {
    this.#unsub?.()
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer)
      p.reject(new Error('bunker closed'))
    }
    this.#pending.clear()
  }

  async getPublicKey(): Promise<Pubkey> {
    this.#userPubkey ??= parsePubkey(await this.#request('get_public_key', []))
    return this.#userPubkey
  }

  async signEvent(template: EventTemplate): Promise<NostrEvent> {
    const result = await this.#request('sign_event', [JSON.stringify(template)])
    return JSON.parse(result) as NostrEvent
  }

  async nip44Encrypt(peer: Pubkey, plaintext: string): Promise<string> {
    return this.#request('nip44_encrypt', [peer, plaintext])
  }
  async nip44Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    return this.#request('nip44_decrypt', [peer, ciphertext])
  }
  async nip04Decrypt(peer: Pubkey, ciphertext: string): Promise<string> {
    return this.#request('nip04_decrypt', [peer, ciphertext])
  }
  async ping(): Promise<string> {
    return this.#request('ping', [])
  }

  /** Persist enough to reconnect (never the user's key — only ours + the URI bits). */
  toPayload(): string {
    return JSON.stringify({
      type: 'nip46',
      signerPubkey: this.#pointer.signerPubkey,
      relays: this.#pointer.relays,
      secret: this.#pointer.secret,
    })
  }

  #request(method: string, params: string[]): Promise<string> {
    const id = this.#opts.genId()
    const rpc: Rpc = { id, method, params }
    const promise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`nip46 ${method} timed out`))
      }, this.#opts.timeout)
      this.#pending.set(id, { resolve, reject, timer })
    })
    const content = nip44.encryptTo(JSON.stringify(rpc), this.#opts.clientSecret, this.#pointer.signerPubkey)
    const event = finalizeEvent(
      { kind: KIND, content, tags: [['p', this.#pointer.signerPubkey]], created_at: Math.floor(Date.now() / 1000) },
      this.#opts.clientSecret,
    )
    this.#opts.transport.publish(event, this.#pointer.relays).catch((err) => {
      const pending = this.#pending.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.#pending.delete(id)
        pending.reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    return promise
  }

  #onResponse(event: NostrEvent): void {
    let decrypted: string
    try {
      decrypted = nip44.decryptFrom(event.content, this.#opts.clientSecret, this.#pointer.signerPubkey)
    } catch {
      return // not for us / unreadable
    }
    const res = JSON.parse(decrypted) as RpcResponse
    // An auth challenge: surface the URL and keep waiting for the real response.
    if (res.result === 'auth_url' && res.error) {
      this.#opts.onAuthUrl?.(res.error)
      return
    }
    const pending = this.#pending.get(res.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.#pending.delete(res.id)
    if (res.error) pending.reject(new Error(res.error))
    else pending.resolve(res.result ?? '')
  }
}

/** Connect to a bunker from its URI. Returns a ready-to-use, connected signer. */
export async function bunkerSigner(uri: string, opts: BunkerOptions): Promise<BunkerSigner> {
  const signer = new BunkerSigner(parseBunkerUri(uri), opts)
  await signer.connect()
  return signer
}
