// Discovery NIPs: NIP-05 DNS identity verification, NIP-65 relay-list builder,
// NIP-89 app handler recommendations.
import type { EventTemplate, NostrEvent } from '@hopstr/core'

// ── NIP-05: name@domain → pubkey ──

export interface Nip05Result {
  pubkey?: string
  relays?: string[]
}

/** Verify a NIP-05 identifier (`name@domain`) resolves to `pubkey`. */
export async function verifyNip05(
  identifier: string,
  expectedPubkey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const result = await resolveNip05(identifier, fetchImpl)
  return result.pubkey === expectedPubkey
}

/** Resolve a NIP-05 identifier to its pubkey + relay hints. */
export async function resolveNip05(identifier: string, fetchImpl: typeof fetch = fetch): Promise<Nip05Result> {
  const [name, domain] = identifier.split('@')
  if (!name || !domain) throw new Error(`invalid NIP-05 identifier: ${identifier}`)
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`NIP-05 fetch failed: ${res.status}`)
  const json = (await res.json()) as { names?: Record<string, string>; relays?: Record<string, string[]> }
  const pubkey = json.names?.[name]
  const out: Nip05Result = {}
  if (pubkey) {
    out.pubkey = pubkey
    const relays = json.relays?.[pubkey]
    if (relays) out.relays = relays
  }
  return out
}

// ── NIP-65: relay list metadata (kind 10002) builder; the router parses it ──

export interface RelayEntry {
  url: string
  read?: boolean
  write?: boolean
}

export function relayListMetadata(relays: RelayEntry[]): EventTemplate {
  const tags = relays.map((r) => {
    const read = r.read ?? true
    const write = r.write ?? true
    if (read && write) return ['r', r.url]
    return ['r', r.url, read ? 'read' : 'write']
  })
  return { kind: 10002, content: '', tags }
}

// ── NIP-89: recommended application handlers ──

/** Build a kind-31989 handler recommendation for a given event kind. */
export function handlerRecommendation(eventKind: number, handlerAddr: string, relay = ''): EventTemplate {
  return {
    kind: 31989,
    content: '',
    tags: [
      ['d', String(eventKind)],
      ['a', handlerAddr, relay, 'web'],
    ],
  }
}

/** Parse a kind-31990 handler information event's supported kinds + name. */
export function parseHandlerInfo(event: NostrEvent): { kinds: number[]; name?: string } {
  const kinds = event.tags.filter((t) => t[0] === 'k' && t[1]).map((t) => Number(t[1]))
  let name: string | undefined
  try {
    name = (JSON.parse(event.content) as { name?: string }).name
  } catch {
    // content not JSON metadata
  }
  return name !== undefined ? { kinds, name } : { kinds }
}
