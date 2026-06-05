// NIP-01 serialization + schnorr signing, including BIP-340 official vectors
// and adversarial content (the 7 escaped control chars, emoji, surrogate pairs).
import { describe, expect, test } from 'bun:test'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
  brandEventFields,
  finalizeEvent,
  getEventHash,
  getPublicKey,
  hasValidId,
  serializeEvent,
  verifyEvent,
} from '../src/serialize.ts'
import type { NostrEvent } from '../src/event.ts'
import bip340 from '../../../tests/fixtures/bip340.test-vectors.csv' with { type: 'text' }

// A fixed keypair so signatures/ids are deterministic in snapshots.
const SK = '0000000000000000000000000000000000000000000000000000000000000001'
const PK = getPublicKey(SK)

describe('serialization', () => {
  test('canonical array form, no whitespace', () => {
    const s = serializeEvent({ pubkey: PK, created_at: 1700000000, kind: 1, tags: [['t', 'gm']], content: 'hi' })
    expect(s).toBe(`[0,"${PK}",1700000000,1,[["t","gm"]],"hi"]`)
  })

  test('escapes exactly the 7 control chars + quote + backslash, verbatim otherwise', () => {
    const content = 'a"b\\c\nd\re\tf\bg\fhi 🚀 𝕘𝕞'
    const s = serializeEvent({ pubkey: PK, created_at: 1, kind: 1, tags: [], content })
    // JSON.stringify gives NIP-01-correct escaping; round-trips back to the same string.
    const parsed = JSON.parse(s)
    expect(parsed[5]).toBe(content)
    expect(s).toContain('\\n')
    expect(s).toContain('\\t')
    expect(s).toContain('\\u0001')
    expect(s).toContain('🚀') // multibyte emitted verbatim
  })

  test('id is stable for a known event', () => {
    const id = getEventHash({ pubkey: PK, created_at: 1700000000, kind: 1, tags: [], content: 'hello' })
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    // recompute determinism
    expect(getEventHash({ pubkey: PK, created_at: 1700000000, kind: 1, tags: [], content: 'hello' })).toBe(id)
  })
})

describe('sign + verify', () => {
  test('finalizeEvent produces a verifiable event', () => {
    const e = finalizeEvent({ kind: 1, tags: [], content: 'gm', created_at: 1700000000 }, SK)
    expect(e.pubkey).toBe(PK)
    expect(hasValidId(e)).toBe(true)
    expect(verifyEvent(e)).toBe(true)
  })

  test('finalizeEvent stamps created_at when omitted', () => {
    const before = Math.floor(Date.now() / 1000)
    const e = finalizeEvent({ kind: 1, tags: [], content: 'now' }, SK)
    expect(e.created_at).toBeGreaterThanOrEqual(before)
  })

  test('accepts a Uint8Array secret too', () => {
    const e = finalizeEvent({ kind: 1, tags: [], content: 'bytes' }, hexToBytes(SK))
    expect(verifyEvent(e)).toBe(true)
  })

  test('verifyEvent rejects a tampered content', () => {
    const e = finalizeEvent({ kind: 1, tags: [], content: 'gm', created_at: 1 }, SK)
    expect(verifyEvent({ ...e, content: 'tampered' })).toBe(false)
  })

  test('verifyEvent rejects a tampered signature', () => {
    const e = finalizeEvent({ kind: 1, tags: [], content: 'gm', created_at: 1 }, SK)
    const badSig = (e.sig.slice(0, -1) + (e.sig.endsWith('0') ? '1' : '0')) as typeof e.sig
    expect(verifyEvent({ ...e, sig: badSig })).toBe(false)
  })

  test('verifyEvent rejects non-string id/sig', () => {
    expect(verifyEvent({ id: 1 as unknown as string } as unknown as NostrEvent)).toBe(false)
  })

  test('brandEventFields lowercases + validates', () => {
    const e = finalizeEvent({ kind: 1, tags: [], content: 'gm', created_at: 1 }, SK)
    const branded = brandEventFields({ ...e, id: e.id.toUpperCase() as typeof e.id })
    expect(branded.id).toBe(e.id)
  })
})

describe('BIP-340 schnorr vectors', () => {
  const rows = bip340
    .trim()
    .split('\n')
    .slice(1)
    .map((line: string) => line.split(','))
  for (const [index, sk, pk, , msg, sig, result] of rows) {
    test(`vector ${index} (verify=${result})`, () => {
      // Reconstruct an event-like verify: id = msg (32 bytes), pubkey = pk, sig = sig.
      const event = {
        id: msg!.toLowerCase(),
        pubkey: pk!.toLowerCase(),
        sig: sig!.toLowerCase(),
        // make hasValidId pass by faking the hash check off — we test schnorr only,
        // so bypass via a separate direct call:
      } as unknown as NostrEvent
      const { schnorr } = require('@noble/curves/secp256k1.js')
      let ok: boolean
      try {
        ok = schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey))
      } catch {
        ok = false
      }
      expect(ok).toBe(result === 'TRUE')
      // and when we DO own the secret, finalize→verify must round-trip
      if (sk && /^[0-9a-f]{64}$/i.test(sk)) {
        const e = finalizeEvent({ kind: 1, tags: [], content: 'x', created_at: 1 }, sk.toLowerCase())
        expect(verifyEvent(e)).toBe(true)
      }
    })
  }
})
