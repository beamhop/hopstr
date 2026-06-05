// NIP-11 relay information document. Fetched over HTTPS with the nostr+json Accept.
export interface RelayInformation {
  name?: string
  description?: string
  pubkey?: string
  contact?: string
  supported_nips?: number[]
  software?: string
  version?: string
  limitation?: {
    max_message_length?: number
    max_subscriptions?: number
    max_filters?: number
    max_limit?: number
    max_subid_length?: number
    min_pow_difficulty?: number
    auth_required?: boolean
    payment_required?: boolean
    restricted_writes?: boolean
  }
  [key: string]: unknown
}

/** Convert wss://relay → https://relay for the info-document fetch. */
export function infoUrl(relayUrl: string): string {
  return relayUrl.replace(/^ws/, 'http')
}

/** Fetch a relay's NIP-11 info document. `fetchImpl` is injectable for tests. */
export async function fetchRelayInformation(
  relayUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelayInformation> {
  const res = await fetchImpl(infoUrl(relayUrl), { headers: { Accept: 'application/nostr+json' } })
  if (!res.ok) throw new Error(`relay info fetch failed: ${res.status}`)
  return (await res.json()) as RelayInformation
}

/** Does the relay advertise support for a given NIP number? */
export function supportsNip(info: RelayInformation, nip: number): boolean {
  return Array.isArray(info.supported_nips) && info.supported_nips.includes(nip)
}

/** Clamp a requested limit to the relay's advertised max_limit, if any. */
export function clampLimit(info: RelayInformation, requested: number): number {
  const max = info.limitation?.max_limit
  return typeof max === 'number' && max > 0 ? Math.min(requested, max) : requested
}
