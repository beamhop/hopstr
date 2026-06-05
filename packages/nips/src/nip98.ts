// NIP-98 HTTP Auth: a kind-27235 event proving control of a key, sent as an
// `Authorization: Nostr <base64-event>` header on an HTTP request.
import { base64, bytesToHex, sha256, utf8ToBytes, type EventTemplate, type NostrEvent } from '@nostragent/core'

export const KIND = 27235

export interface HttpAuthInput {
  url: string
  method: string
  /** optional request body — its sha256 is committed via a `payload` tag */
  body?: string
  created_at?: number
}

/** Build the kind-27235 template to authorize an HTTP request. */
export function httpAuthTemplate(input: HttpAuthInput): EventTemplate {
  const tags: string[][] = [
    ['u', input.url],
    ['method', input.method.toUpperCase()],
  ]
  if (input.body !== undefined) tags.push(['payload', bytesToHex(sha256(utf8ToBytes(input.body)))])
  const t: EventTemplate = { kind: KIND, content: '', tags }
  if (input.created_at !== undefined) t.created_at = input.created_at
  return t
}

/** Encode a signed kind-27235 event as the `Authorization` header value. */
export function authHeader(signed: NostrEvent): string {
  return `Nostr ${base64.encode(utf8ToBytes(JSON.stringify(signed)))}`
}

/** Decode an `Authorization: Nostr ...` header back into the event. */
export function decodeAuthHeader(header: string): NostrEvent {
  const prefix = 'Nostr '
  if (!header.startsWith(prefix)) throw new Error('not a Nostr authorization header')
  const json = new TextDecoder().decode(base64.decode(header.slice(prefix.length)))
  return JSON.parse(json) as NostrEvent
}

/**
 * Validate a NIP-98 auth event against the expected request. Checks kind, the
 * `u`/`method` tags, freshness (default ±60s), and (if given) the body hash.
 * Does NOT verify the signature — do that with core's verifyEvent first.
 */
export function validateHttpAuth(
  event: NostrEvent,
  expected: { url: string; method: string; body?: string; now?: number; toleranceSec?: number },
): boolean {
  if (event.kind !== KIND) return false
  const u = event.tags.find((t) => t[0] === 'u')?.[1]
  const method = event.tags.find((t) => t[0] === 'method')?.[1]
  if (u !== expected.url || method !== expected.method.toUpperCase()) return false
  const now = expected.now ?? Math.floor(Date.now() / 1000)
  const tolerance = expected.toleranceSec ?? 60
  if (Math.abs(event.created_at - now) > tolerance) return false
  if (expected.body !== undefined) {
    const payload = event.tags.find((t) => t[0] === 'payload')?.[1]
    if (payload !== bytesToHex(sha256(utf8ToBytes(expected.body)))) return false
  }
  return true
}
