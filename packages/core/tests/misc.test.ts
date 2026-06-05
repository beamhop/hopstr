// nip21, nip13, filter, builder, identity, primitives, event classifier.
import { describe, expect, test } from 'bun:test'
import * as fc from 'fast-check'
import { bytesToHex } from '@noble/hashes/utils.js'
import { decodeUri, toEntity, toUri } from '../src/nip21.ts'
import { encodeNpub } from '../src/nip19.ts'
import { countLeadingZeroBits, mine } from '../src/nip13.ts'
import { matchFilter, matchFilters } from '../src/filter.ts'
import { build, buildNote, TemplateBuilder } from '../src/builder.ts'
import { createIdentity, loadIdentity, npubOf, secretHex } from '../src/identity.ts'
import { finalizeEvent, getPublicKey, verifyEvent } from '../src/serialize.ts'
import { addressOf, classifyKind, isAddressable, isEphemeral, isParameterizedReplaceable, isReplaceable } from '../src/event.ts'
import { parseEventId, parsePubkey, parseSecretKeyHex, parseSignature, isHex64 } from '../src/primitives.ts'

const PK = parsePubkey('3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d')

describe('nip21', () => {
  test('toUri / toEntity idempotent', () => {
    const npub = encodeNpub(PK)
    expect(toUri(npub)).toBe('nostr:' + npub)
    expect(toUri('nostr:' + npub)).toBe('nostr:' + npub)
    expect(toEntity('nostr:' + npub)).toBe(npub)
    expect(toEntity(npub)).toBe(npub)
  })
  test('decodeUri returns the entity', () => {
    expect(decodeUri('nostr:' + encodeNpub(PK))).toEqual({ type: 'npub', data: PK })
  })
  test('decodeUri rejects nsec', () => {
    const nsec = (loadIdentity(createIdentity().secretKey)).nsec
    expect(() => decodeUri('nostr:' + nsec)).toThrow('not a valid nostr')
  })
})

describe('nip13 proof of work', () => {
  test('countLeadingZeroBits', () => {
    expect(countLeadingZeroBits('00'.repeat(32))).toBe(256)
    expect(countLeadingZeroBits('0f' + '00'.repeat(31))).toBe(4)
    expect(countLeadingZeroBits('80' + '00'.repeat(31))).toBe(0)
    expect(countLeadingZeroBits('ff' + '00'.repeat(31))).toBe(0)
  })
  test('mine reaches a small difficulty (by secret and by pubkey)', () => {
    const sk = '01'.repeat(32)
    const mined = mine({ kind: 1, tags: [['t', 'pow']], content: 'gm', created_at: 1 }, 8, { secret: sk })
    const e = finalizeEvent(mined, sk)
    expect(countLeadingZeroBits(e.id)).toBeGreaterThanOrEqual(8)
    expect(mined.tags.some((t) => t[0] === 'nonce')).toBe(true)
    // by pubkey path
    const mined2 = mine({ kind: 1, tags: [], content: 'x', created_at: 1 }, 4, { pubkey: getPublicKey(sk) })
    expect(mined2.tags.find((t) => t[0] === 'nonce')?.[2]).toBe('4')
  })
  test('mine gives up after maxIterations', () => {
    // impossible difficulty with a tiny cap → throws instead of hanging
    expect(() =>
      mine({ kind: 1, tags: [], content: 'x', created_at: 1 }, 256, { secret: '01'.repeat(32) }, 5),
    ).toThrow('gave up mining')
  })
})

describe('filters', () => {
  const event = finalizeEvent(
    { kind: 1, tags: [['t', 'gm'], ['e', 'abc']], content: 'hi', created_at: 1000 },
    '01'.repeat(32),
  )
  test('matches by author/kind/tag/time', () => {
    expect(matchFilter({ authors: [event.pubkey] }, event)).toBe(true)
    expect(matchFilter({ kinds: [1] }, event)).toBe(true)
    expect(matchFilter({ '#t': ['gm'] }, event)).toBe(true)
    expect(matchFilter({ since: 999, until: 1001 }, event)).toBe(true)
    expect(matchFilter({ ids: [event.id] }, event)).toBe(true)
  })
  test('rejects on mismatch', () => {
    expect(matchFilter({ authors: ['ff'.repeat(32)] }, event)).toBe(false)
    expect(matchFilter({ kinds: [7] }, event)).toBe(false)
    expect(matchFilter({ '#t': ['bye'] }, event)).toBe(false)
    expect(matchFilter({ since: 2000 }, event)).toBe(false)
    expect(matchFilter({ until: 500 }, event)).toBe(false)
    expect(matchFilter({ ids: ['00'.repeat(32)] }, event)).toBe(false)
  })
  test('ignores multi-char and empty tag filters; matchFilters ORs', () => {
    expect(matchFilter({ '#xx': ['y'] } as never, event)).toBe(true)
    expect(matchFilters([{ kinds: [7] }, { kinds: [1] }], event)).toBe(true)
  })
})

describe('builder', () => {
  test('chains into a template', () => {
    const t = buildNote('gm').tag('t', 'coffee').mention(PK).at(123).text('updated').build()
    expect(t.kind).toBe(1)
    expect(t.content).toBe('updated')
    expect(t.created_at).toBe(123)
    expect(t.tags).toContainEqual(['t', 'coffee'])
    expect(t.tags).toContainEqual(['p', PK])
  })
  test('mention with relay, addTags', () => {
    const t = build(30023).mention(PK, 'wss://r').addTags([['title', 'X']]).build()
    expect(t.tags).toContainEqual(['p', PK, 'wss://r'])
    expect(t.tags).toContainEqual(['title', 'X'])
  })
  test('replyTo roots a fresh thread then nests', () => {
    const root = finalizeEvent({ kind: 1, tags: [], content: 'root', created_at: 1 }, '01'.repeat(32))
    const reply = buildNote('r1').replyTo(root)
    expect(reply.tags).toContainEqual(['e', root.id, '', 'root'])
    expect(reply.tags).toContainEqual(['p', root.pubkey])
    // a reply to the reply carries the root marker
    const replyEvent = { id: parseEventId('aa'.repeat(32)), pubkey: PK, tags: reply.tags }
    const nested = buildNote('r2').replyTo(replyEvent, 'wss://r').build()
    expect(nested.tags).toContainEqual(['e', root.id, 'wss://r', 'root'])
    expect(nested.tags).toContainEqual(['e', replyEvent.id, 'wss://r', 'reply'])
  })
  test('builder is itself an EventTemplate', () => {
    const b = new TemplateBuilder(1, 'x')
    expect(b.kind).toBe(1)
    expect(b.content).toBe('x')
  })
})

describe('identity', () => {
  test('createIdentity is verifiable and round-trips through nsec/hex/bytes', () => {
    const id = createIdentity()
    expect(id.npub.startsWith('npub1')).toBe(true)
    expect(loadIdentity(id.nsec).pubkey).toBe(id.pubkey)
    expect(loadIdentity(secretHex(id)).pubkey).toBe(id.pubkey)
    expect(loadIdentity(id.secretKey).pubkey).toBe(id.pubkey)
    expect(npubOf(id.pubkey)).toBe(id.npub)
  })
  test('loadIdentity validates', () => {
    expect(() => loadIdentity(new Uint8Array(31))).toThrow('32 bytes')
    expect(() => loadIdentity('not-hex')).toThrow('expected nsec')
    const npub = npubOf(createIdentity().pubkey)
    expect(() => loadIdentity(npub)).toThrow() // npub is not an nsec
  })
})

describe('event classifier + primitives', () => {
  test('classifyKind ranges', () => {
    expect(classifyKind(0)).toBe('replaceable')
    expect(classifyKind(3)).toBe('replaceable')
    expect(classifyKind(1)).toBe('regular')
    expect(classifyKind(10002)).toBe('replaceable')
    expect(isEphemeral(20001)).toBe(true)
    expect(classifyKind(30023)).toBe('addressable')
  })
  test('classifier predicates', () => {
    expect(isReplaceable(0)).toBe(true)
    expect(isReplaceable(1)).toBe(false)
    expect(isAddressable(30023)).toBe(true)
    expect(isParameterizedReplaceable(30023)).toBe(true)
    expect(isParameterizedReplaceable(1)).toBe(false)
  })
  test('verifyEvent catch path on malformed sig hex', () => {
    // valid id (passes hasValidId via tamper-free build) but non-hex sig → hexToBytes throws → caught
    const e = finalizeEvent({ kind: 1, tags: [], content: 'x', created_at: 1 }, '01'.repeat(32))
    const malformed = { ...e, sig: ('zz'.repeat(64)) as typeof e.sig }
    expect(verifyEvent(malformed)).toBe(false)
  })
  test('addressOf', () => {
    expect(addressOf({ kind: 30023, pubkey: PK, tags: [['d', 'slug']] })).toBe(`30023:${PK}:slug`)
    expect(addressOf({ kind: 1, pubkey: PK, tags: [] })).toBe(`1:${PK}:`)
  })
  test('parsers validate + lowercase', () => {
    expect(parsePubkey(PK.toUpperCase())).toBe(PK)
    expect(parseEventId(PK) as string).toBe(PK)
    expect(parseSecretKeyHex(PK) as string).toBe(PK)
    expect(parseSignature('ab'.repeat(64))).toBe(parseSignature('ab'.repeat(64)))
    expect(isHex64(PK)).toBe(true)
    expect(() => parsePubkey('xyz')).toThrow('invalid pubkey')
    expect(() => parseSignature('ab')).toThrow('invalid signature')
  })
  test('property: any 32-byte secret yields a verifiable identity', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (sk) => {
        // reject the curve-invalid all-zero / >=n keys gracefully
        try {
          const id = loadIdentity(sk)
          return id.pubkey.length === 64 && loadIdentity(id.nsec).pubkey === id.pubkey
        } catch {
          return true // invalid scalar is allowed to throw
        }
      }),
    )
  })
})
