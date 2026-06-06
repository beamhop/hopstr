// Nostr relay wire protocol (NIP-01 + NIP-42 + NIP-45) message types and parsing.
import type { Filter, NostrEvent } from '@hopstr/core'

// Client → relay
export type ClientMessage =
  | ['EVENT', NostrEvent]
  | ['REQ', string, ...Filter[]]
  | ['CLOSE', string]
  | ['AUTH', NostrEvent]
  | ['COUNT', string, ...Filter[]]

// Relay → client
export type RelayMessage =
  | { type: 'EVENT'; sub: string; event: NostrEvent }
  | { type: 'OK'; id: string; ok: boolean; reason: string }
  | { type: 'EOSE'; sub: string }
  | { type: 'CLOSED'; sub: string; reason: string }
  | { type: 'NOTICE'; message: string }
  | { type: 'AUTH'; challenge: string }
  | { type: 'COUNT'; sub: string; count: number }

/** The standardized machine-readable prefix on an OK/CLOSED reason, if any. */
export type ReasonPrefix =
  | 'auth-required'
  | 'restricted'
  | 'pow'
  | 'duplicate'
  | 'blocked'
  | 'rate-limited'
  | 'invalid'
  | 'error'

const KNOWN_PREFIXES: ReasonPrefix[] = [
  'auth-required',
  'restricted',
  'pow',
  'duplicate',
  'blocked',
  'rate-limited',
  'invalid',
  'error',
]

/** Pull the `prefix:` off a reason string (e.g. "auth-required: ..." → "auth-required"). */
export function reasonPrefix(reason: string): ReasonPrefix | undefined {
  const colon = reason.indexOf(':')
  if (colon === -1) return undefined
  const candidate = reason.slice(0, colon)
  return (KNOWN_PREFIXES as string[]).includes(candidate) ? (candidate as ReasonPrefix) : undefined
}

/** Parse a raw relay frame (already JSON.parsed array) into a typed message. */
export function parseRelayMessage(data: unknown): RelayMessage | undefined {
  if (!Array.isArray(data) || data.length === 0) return undefined
  const [kind] = data
  switch (kind) {
    case 'EVENT':
      if (typeof data[1] === 'string' && data[2] && typeof data[2] === 'object')
        return { type: 'EVENT', sub: data[1], event: data[2] as NostrEvent }
      return undefined
    case 'OK':
      if (typeof data[1] === 'string' && typeof data[2] === 'boolean')
        return { type: 'OK', id: data[1], ok: data[2], reason: typeof data[3] === 'string' ? data[3] : '' }
      return undefined
    case 'EOSE':
      if (typeof data[1] === 'string') return { type: 'EOSE', sub: data[1] }
      return undefined
    case 'CLOSED':
      if (typeof data[1] === 'string')
        return { type: 'CLOSED', sub: data[1], reason: typeof data[2] === 'string' ? data[2] : '' }
      return undefined
    case 'NOTICE':
      if (typeof data[1] === 'string') return { type: 'NOTICE', message: data[1] }
      return undefined
    case 'AUTH':
      if (typeof data[1] === 'string') return { type: 'AUTH', challenge: data[1] }
      return undefined
    case 'COUNT':
      if (typeof data[1] === 'string' && data[2] && typeof data[2].count === 'number')
        return { type: 'COUNT', sub: data[1], count: data[2].count }
      return undefined
    default:
      return undefined
  }
}

/** Serialize a client message to a JSON string for the socket. */
export function serializeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message)
}
