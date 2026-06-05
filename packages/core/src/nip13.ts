// NIP-13 proof of work: leading-zero-bit difficulty on the event id.
import type { EventTemplate } from './event.ts'
import { getEventHash, getPublicKey } from './serialize.ts'
import { hexToBytes } from './primitives.ts'

/** Count leading zero BITS in a 32-byte hex id (NIP-13 difficulty metric). */
export function countLeadingZeroBits(hex: string): number {
  let count = 0
  const bytes = hexToBytes(hex)
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8
      continue
    }
    count += Math.clz32(byte) - 24 // clz32 treats it as 32-bit; subtract the high 24
    break
  }
  return count
}

/**
 * Mine a `nonce` tag until the event id has >= `difficulty` leading zero bits.
 * Returns a template (still unsigned) with the committed `["nonce", n, target]`
 * tag. Pass the author pubkey (or a secret to derive it) so the id is real.
 */
export function mine(
  template: EventTemplate,
  difficulty: number,
  author: { pubkey: string } | { secret: Uint8Array | string },
  maxIterations = 50_000_000,
): EventTemplate {
  const pubkey = 'pubkey' in author ? author.pubkey : getPublicKey(author.secret)
  const created_at = template.created_at ?? Math.floor(Date.now() / 1000)
  const baseTags = template.tags.filter((t) => t[0] !== 'nonce')
  for (let nonce = 0; nonce < maxIterations; nonce++) {
    const tags = [...baseTags, ['nonce', String(nonce), String(difficulty)]]
    const id = getEventHash({ pubkey, created_at, kind: template.kind, tags, content: template.content })
    if (countLeadingZeroBits(id) >= difficulty)
      return { kind: template.kind, content: template.content, created_at, tags }
  }
  throw new Error(`gave up mining ${difficulty} bits after ${maxIterations} iterations`)
}
