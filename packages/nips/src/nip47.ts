// NIP-47 Nostr Wallet Connect: a client controls a remote lightning wallet over
// relays using encrypted kind-23194 requests / kind-23195 responses.
import {
  finalizeEvent,
  getPublicKey,
  nip44,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'

export const INFO_KIND = 13194
export const REQUEST_KIND = 23194
export const RESPONSE_KIND = 23195
export const NOTIFICATION_KIND = 23196

export interface WalletConnection {
  /** the wallet service's pubkey */
  walletPubkey: Pubkey
  /** relay to talk to the wallet over */
  relay: string
  /** the client secret granted by the wallet (hex) */
  secret: string
  /** optional default lud16 for the connection */
  lud16?: string
}

/** Parse a `nostr+walletconnect://` connection URI. */
export function parseConnectionUri(uri: string): WalletConnection {
  if (!uri.startsWith('nostr+walletconnect://')) throw new Error('expected a nostr+walletconnect:// URI')
  const url = new URL(uri)
  const walletPubkey = (url.hostname || url.pathname.replace(/^\/+/, '')) as Pubkey
  const relay = url.searchParams.get('relay')
  const secret = url.searchParams.get('secret')
  if (!relay) throw new Error('NWC URI missing relay')
  if (!secret) throw new Error('NWC URI missing secret')
  const conn: WalletConnection = { walletPubkey, relay, secret }
  const lud16 = url.searchParams.get('lud16')
  if (lud16) conn.lud16 = lud16
  return conn
}

export interface NwcRequest {
  method: 'pay_invoice' | 'get_balance' | 'make_invoice' | 'lookup_invoice' | 'list_transactions' | 'get_info' | string
  params: Record<string, unknown>
}

/** Build a signed, NIP-44-encrypted kind-23194 request event to the wallet. */
export function buildRequest(conn: WalletConnection, request: NwcRequest, created_at?: number): NostrEvent {
  const content = nip44.encryptTo(JSON.stringify(request), conn.secret, conn.walletPubkey)
  const template = {
    kind: REQUEST_KIND,
    content,
    tags: [['p', conn.walletPubkey]],
    created_at: created_at ?? Math.floor(Date.now() / 1000),
  }
  return finalizeEvent(template, conn.secret)
}

export interface NwcResponse {
  result_type: string
  error?: { code: string; message: string }
  result?: Record<string, unknown>
}

/** Decrypt and parse a kind-23195 response from the wallet. */
export function parseResponse(conn: WalletConnection, event: NostrEvent): NwcResponse {
  const json = nip44.decryptFrom(event.content, conn.secret, conn.walletPubkey)
  return JSON.parse(json) as NwcResponse
}

/** Convenience: a pay_invoice request for a bolt11. */
export function payInvoice(conn: WalletConnection, invoice: string, amountMsat?: number): NostrEvent {
  const params: Record<string, unknown> = { invoice }
  if (amountMsat !== undefined) params.amount = amountMsat
  return buildRequest(conn, { method: 'pay_invoice', params })
}

/** The client pubkey derived from the connection secret. */
export function clientPubkey(conn: WalletConnection): Pubkey {
  return getPublicKey(conn.secret)
}
