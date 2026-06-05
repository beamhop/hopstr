// NIP-19 bech32 entities: npub/nsec/note (bare) and nprofile/nevent/naddr/nrelay (TLV).
import { bech32 } from '@scure/base'
import {
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  hexToBytes,
  parseEventId,
  parsePubkey,
  utf8ToBytes,
} from './primitives.ts'
import type { EventId, Pubkey } from './primitives.ts'

// SHOULD be limited to 5000 chars (NIP-19); we pass this as bech32's limit.
const LIMIT = 5000

// ── bare entities ────────────────────────────────────────────────────────────

function encodeBare(prefix: string, hex: string): string {
  return bech32.encode(prefix, bech32.toWords(hexToBytes(hex)), LIMIT)
}

function decodeBare(expectedPrefix: string, value: string): Uint8Array {
  const { prefix, words } = bech32.decode(value as `${string}1${string}`, LIMIT)
  if (prefix !== expectedPrefix) throw new Error(`expected ${expectedPrefix}, got ${prefix}`)
  return bech32.fromWords(words)
}

export const encodeNpub = (pubkey: string): string => encodeBare('npub', parsePubkey(pubkey))
export const encodeNsec = (secret: Uint8Array | string): string =>
  encodeBare('nsec', typeof secret === 'string' ? secret : bytesToHex(secret))
export const encodeNote = (id: string): string => encodeBare('note', parseEventId(id))

export const decodeNpub = (npub: string): Pubkey => bytesToHex(decodeBare('npub', npub)) as Pubkey
export const decodeNsec = (nsec: string): Uint8Array => decodeBare('nsec', nsec)
export const decodeNote = (note: string): EventId => bytesToHex(decodeBare('note', note)) as EventId

// ── TLV entities ──────────────────────────────────────────────────────────────

const TLV = { special: 0, relay: 1, author: 2, kind: 3 } as const

// Decoded pointers carry branded ids (you can trust them). Encoders accept the
// relaxed `*Input` forms (plain hex strings) and validate internally — so you
// never have to brand a pubkey just to build an nprofile.
export interface ProfilePointer {
  pubkey: Pubkey
  relays?: string[]
}
export interface EventPointer {
  id: EventId
  relays?: string[]
  author?: Pubkey
  kind?: number
}
export interface AddressPointer {
  identifier: string
  pubkey: Pubkey
  kind: number
  relays?: string[]
}

export interface ProfilePointerInput {
  pubkey: string
  relays?: string[]
}
export interface EventPointerInput {
  id: string
  relays?: string[]
  author?: string
  kind?: number
}
export interface AddressPointerInput {
  identifier: string
  pubkey: string
  kind: number
  relays?: string[]
}

function writeTLV(entries: Array<[number, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = []
  for (const [type, value] of entries) {
    if (value.length > 255) throw new Error('TLV value too long')
    parts.push(new Uint8Array([type, value.length]), value)
  }
  return concatBytes(...parts)
}

function readTLV(data: Uint8Array): Map<number, Uint8Array[]> {
  const result = new Map<number, Uint8Array[]>()
  let i = 0
  while (i < data.length) {
    const type = data[i]!
    const length = data[i + 1]!
    const value = data.subarray(i + 2, i + 2 + length)
    if (value.length !== length) throw new Error('truncated TLV')
    const list = result.get(type)
    if (list) list.push(value)
    else result.set(type, [value])
    i += 2 + length
  }
  return result
}

function kindToBytes(kind: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, kind, false) // 32-bit big-endian
  return b
}
function bytesToKind(b: Uint8Array): number {
  if (b.length !== 4) throw new Error('invalid kind length')
  return new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false)
}

function relaysToTLV(relays: string[] | undefined): Array<[number, Uint8Array]> {
  return (relays ?? []).map((r) => [TLV.relay, utf8ToBytes(r)] as [number, Uint8Array])
}
function relaysFromTLV(map: Map<number, Uint8Array[]>): string[] | undefined {
  const relays = (map.get(TLV.relay) ?? []).map(bytesToUtf8)
  return relays.length ? relays : undefined
}

export function encodeNprofile(p: ProfilePointerInput): string {
  const data = writeTLV([[TLV.special, hexToBytes(parsePubkey(p.pubkey))], ...relaysToTLV(p.relays)])
  return bech32.encode('nprofile', bech32.toWords(data), LIMIT)
}

export function decodeNprofile(value: string): ProfilePointer {
  const map = readTLV(decodeBare('nprofile', value))
  const special = map.get(TLV.special)?.[0]
  if (!special) throw new Error('nprofile missing pubkey')
  const relays = relaysFromTLV(map)
  return relays ? { pubkey: bytesToHex(special) as Pubkey, relays } : { pubkey: bytesToHex(special) as Pubkey }
}

export function encodeNevent(p: EventPointerInput): string {
  const entries: Array<[number, Uint8Array]> = [
    [TLV.special, hexToBytes(parseEventId(p.id))],
    ...relaysToTLV(p.relays),
  ]
  if (p.author) entries.push([TLV.author, hexToBytes(parsePubkey(p.author))])
  if (p.kind !== undefined) entries.push([TLV.kind, kindToBytes(p.kind)])
  return bech32.encode('nevent', bech32.toWords(writeTLV(entries)), LIMIT)
}

export function decodeNevent(value: string): EventPointer {
  const map = readTLV(decodeBare('nevent', value))
  const special = map.get(TLV.special)?.[0]
  if (!special) throw new Error('nevent missing id')
  const out: EventPointer = { id: bytesToHex(special) as EventId }
  const relays = relaysFromTLV(map)
  if (relays) out.relays = relays
  const author = map.get(TLV.author)?.[0]
  if (author) out.author = bytesToHex(author) as Pubkey
  const kind = map.get(TLV.kind)?.[0]
  if (kind) out.kind = bytesToKind(kind)
  return out
}

export function encodeNaddr(p: AddressPointerInput): string {
  const entries: Array<[number, Uint8Array]> = [
    [TLV.special, utf8ToBytes(p.identifier)],
    ...relaysToTLV(p.relays),
    [TLV.author, hexToBytes(parsePubkey(p.pubkey))],
    [TLV.kind, kindToBytes(p.kind)],
  ]
  return bech32.encode('naddr', bech32.toWords(writeTLV(entries)), LIMIT)
}

export function decodeNaddr(value: string): AddressPointer {
  const map = readTLV(decodeBare('naddr', value))
  const special = map.get(TLV.special)?.[0]
  const author = map.get(TLV.author)?.[0]
  const kind = map.get(TLV.kind)?.[0]
  if (special === undefined || !author || !kind) throw new Error('naddr missing fields')
  const out: AddressPointer = {
    identifier: bytesToUtf8(special),
    pubkey: bytesToHex(author) as Pubkey,
    kind: bytesToKind(kind),
  }
  const relays = relaysFromTLV(map)
  if (relays) out.relays = relays
  return out
}

// ── universal decode ──────────────────────────────────────────────────────────

export type DecodedEntity =
  | { type: 'npub'; data: Pubkey }
  | { type: 'nsec'; data: Uint8Array }
  | { type: 'note'; data: EventId }
  | { type: 'nprofile'; data: ProfilePointer }
  | { type: 'nevent'; data: EventPointer }
  | { type: 'naddr'; data: AddressPointer }

/** Decode any NIP-19 entity into a tagged union. */
export function decode(value: string): DecodedEntity {
  const prefix = value.slice(0, value.lastIndexOf('1'))
  switch (prefix) {
    case 'npub':
      return { type: 'npub', data: decodeNpub(value) }
    case 'nsec':
      return { type: 'nsec', data: decodeNsec(value) }
    case 'note':
      return { type: 'note', data: decodeNote(value) }
    case 'nprofile':
      return { type: 'nprofile', data: decodeNprofile(value) }
    case 'nevent':
      return { type: 'nevent', data: decodeNevent(value) }
    case 'naddr':
      return { type: 'naddr', data: decodeNaddr(value) }
    default:
      throw new Error(`unknown NIP-19 prefix: ${prefix}`)
  }
}
