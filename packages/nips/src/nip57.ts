// NIP-57 zaps: build a kind-9734 zap request, resolve an LNURL-pay endpoint,
// fetch the invoice, and parse a kind-9735 zap receipt.
import type { EventTemplate, NostrEvent } from '@nostragent/core'

export interface ZapRequestInput {
  /** recipient pubkey */
  recipient: string
  /** amount in millisats */
  amountMsat: number
  /** the relays the receipt should be published to */
  relays: string[]
  /** the recipient's lnurl (bech32) */
  lnurl: string
  /** zap a specific event */
  eventId?: string
  /** zap an addressable coordinate */
  addr?: string
  /** optional comment */
  comment?: string
}

/** Build the kind-9734 zap request template (signed, then sent to the LNURL callback). */
export function zapRequest(input: ZapRequestInput): EventTemplate {
  const tags: string[][] = [
    ['relays', ...input.relays],
    ['amount', String(input.amountMsat)],
    ['lnurl', input.lnurl],
    ['p', input.recipient],
  ]
  if (input.eventId) tags.push(['e', input.eventId])
  if (input.addr) tags.push(['a', input.addr])
  return { kind: 9734, content: input.comment ?? '', tags }
}

/** Resolve a lud16 (`user@domain`) to its LNURL-pay metadata URL. */
export function lud16ToUrl(lud16: string): string {
  const [name, domain] = lud16.split('@')
  if (!name || !domain) throw new Error(`invalid lud16: ${lud16}`)
  return `https://${domain}/.well-known/lnurlp/${name}`
}

export interface LnurlPayMetadata {
  callback: string
  minSendable: number
  maxSendable: number
  allowsNostr?: boolean
  nostrPubkey?: string
  [key: string]: unknown
}

/** Build the LNURL callback URL that returns a bolt11 invoice for a zap. */
export function zapCallbackUrl(
  metadata: LnurlPayMetadata,
  signedZapRequest: NostrEvent,
  amountMsat: number,
  lnurl: string,
): string {
  if (!metadata.allowsNostr || !metadata.nostrPubkey) {
    throw new Error('recipient LNURL endpoint does not support Nostr zaps')
  }
  const url = new URL(metadata.callback)
  url.searchParams.set('amount', String(amountMsat))
  url.searchParams.set('nostr', JSON.stringify(signedZapRequest))
  url.searchParams.set('lnurl', lnurl)
  return url.toString()
}

/**
 * Full zap flow against an injected fetch: resolve lud16 → verify → request the
 * invoice. The caller signs the zap request and pays the returned bolt11.
 */
export async function fetchZapInvoice(
  lud16: string,
  signedZapRequest: NostrEvent,
  amountMsat: number,
  lnurl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ invoice: string; metadata: LnurlPayMetadata }> {
  const metaRes = await fetchImpl(lud16ToUrl(lud16))
  if (!metaRes.ok) throw new Error(`LNURL metadata fetch failed: ${metaRes.status}`)
  const metadata = (await metaRes.json()) as LnurlPayMetadata
  const callbackUrl = zapCallbackUrl(metadata, signedZapRequest, amountMsat, lnurl)
  const invoiceRes = await fetchImpl(callbackUrl)
  if (!invoiceRes.ok) throw new Error(`LNURL callback failed: ${invoiceRes.status}`)
  const body = (await invoiceRes.json()) as { pr?: string; reason?: string }
  if (!body.pr) throw new Error(`no invoice returned: ${body.reason ?? 'unknown error'}`)
  return { invoice: body.pr, metadata }
}

export interface ZapReceipt {
  bolt11: string
  recipient?: string
  eventId?: string
  request?: NostrEvent
  amountMsat?: number
}

/** Parse a kind-9735 zap receipt. */
export function parseZapReceipt(event: NostrEvent): ZapReceipt {
  const tag = (name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
  const out: ZapReceipt = { bolt11: tag('bolt11') ?? '' }
  const recipient = tag('p')
  const eventId = tag('e')
  if (recipient) out.recipient = recipient
  if (eventId) out.eventId = eventId
  const description = tag('description')
  if (description) {
    try {
      const request = JSON.parse(description) as NostrEvent
      out.request = request
      const amount = request.tags.find((t) => t[0] === 'amount')?.[1]
      if (amount) out.amountMsat = Number(amount)
    } catch {
      // description wasn't a valid zap request
    }
  }
  return out
}
