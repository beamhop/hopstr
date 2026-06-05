// Long-tail modules: media, moderation, discovery, extra, kinds registry.
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, type NostrEvent } from '@nostragent/core'
import * as media from '../src/media.ts'
import * as moderation from '../src/moderation.ts'
import * as discovery from '../src/discovery.ts'
import * as extra from '../src/extra.ts'
import { KIND_REGISTRY, kindInfo, nipsWithKinds } from '../src/kinds.ts'

const SK = '01'.repeat(32)
const PK = getPublicKey(SK)
const ID = 'ab'.repeat(32)
const sign = (t: { kind: number; tags: string[][]; content: string }): NostrEvent =>
  finalizeEvent({ created_at: 1, ...t }, SK)

describe('kind registry', () => {
  test('kindInfo for known + unknown kinds', () => {
    expect(kindInfo(1).label).toBe('Short Text Note')
    expect(kindInfo(1).nip).toBe('10')
    expect(kindInfo(30023).behavior).toBe('addressable')
    expect(kindInfo(10002).behavior).toBe('replaceable')
    const unknown = kindInfo(99999)
    expect(unknown.label).toContain('Unknown')
    expect(unknown.nip).toBe('?')
  })
  test('registry has the key kinds and nipsWithKinds is populated', () => {
    expect(KIND_REGISTRY.has(1059)).toBe(true)
    expect(KIND_REGISTRY.get(1059)?.nip).toBe('59')
    expect(nipsWithKinds().has('59')).toBe(true)
    expect(nipsWithKinds().size).toBeGreaterThan(30)
  })
})

describe('NIP-92/94 media metadata', () => {
  test('imeta tag round-trips', () => {
    const meta = { url: 'https://i/x.png', m: 'image/png', dim: '800x600', alt: 'a cat' }
    const event = sign({ kind: 1, tags: [media.imetaTag(meta)], content: 'pic' })
    const parsed = media.parseImeta(event)
    expect(parsed[0]?.url).toBe('https://i/x.png')
    expect(parsed[0]?.m).toBe('image/png')
    expect(parsed[0]?.dim).toBe('800x600')
  })
  test('file metadata (kind 1063) round-trips', () => {
    const f = { url: 'https://f/x.pdf', mimeType: 'application/pdf', hash: 'cd'.repeat(32), size: 1024, dim: '1x1', blurhash: 'L', summary: 's' }
    const event = sign(media.fileMetadata(f, 'a file'))
    expect(event.kind).toBe(1063)
    const parsed = media.parseFileMetadata(event)
    expect(parsed.url).toBe(f.url)
    expect(parsed.size).toBe(1024)
    expect(parsed.summary).toBe('s')
  })
  test('picture (kind 20) and video (kind 21/22)', () => {
    const pic = media.picturePost('caption', [{ url: 'https://i/1.jpg', m: 'image/jpeg' }], ['photography'])
    expect(pic.kind).toBe(20)
    expect(pic.tags).toContainEqual(['t', 'photography'])
    expect(media.videoEvent({ title: 'V', videos: [{ url: 'https://v/1.mp4' }], duration: 60 }).kind).toBe(21)
    expect(media.videoEvent({ title: 'short', videos: [{ url: 'https://v/2.mp4' }], short: true }).kind).toBe(22)
  })
})

describe('moderation', () => {
  test('report (kind 1984) with event + pubkey', () => {
    const r = moderation.report({ eventId: ID, pubkey: PK, type: 'spam', reason: 'obvious spam' })
    expect(r.kind).toBe(1984)
    expect(r.tags).toContainEqual(['p', PK, 'spam'])
    expect(r.tags).toContainEqual(['e', ID, 'spam'])
    const parsed = moderation.parseReport(sign(r))
    expect(parsed.pubkey).toBe(PK)
    expect(parsed.eventId).toBe(ID)
    expect(parsed.type).toBe('spam')
    // pubkey-only report
    expect(moderation.report({ pubkey: PK, type: 'impersonation' }).tags.some((t) => t[0] === 'e')).toBe(false)
  })
  test('label (kind 1985) round-trips', () => {
    const l = moderation.label({ namespace: 'ISO-639-1', labels: ['en'], eventIds: [ID], pubkeys: [PK] })
    expect(l.kind).toBe(1985)
    const parsed = moderation.parseLabels(sign(l))
    expect(parsed.namespace).toBe('ISO-639-1')
    expect(parsed.values).toContain('en')
    expect(parsed.eventIds).toContain(ID)
    expect(parsed.pubkeys).toContain(PK)
  })
  test('content warning', () => {
    const warned = moderation.withContentWarning({ kind: 1, content: 'nsfw', tags: [] }, 'nudity')
    expect(warned.tags).toContainEqual(['content-warning', 'nudity'])
    expect(moderation.contentWarning(sign(warned))).toBe('nudity')
    expect(moderation.contentWarning(sign({ kind: 1, content: 'safe', tags: [] }))).toBeNull()
  })
})

describe('discovery', () => {
  test('resolveNip05 + verifyNip05 via injected fetch', async () => {
    const fakeFetch = (async (url: string) => {
      expect(url).toContain('/.well-known/nostr.json?name=alice')
      return { ok: true, json: async () => ({ names: { alice: PK }, relays: { [PK]: ['wss://r'] } }) }
    }) as unknown as typeof fetch
    const result = await discovery.resolveNip05('alice@example.com', fakeFetch)
    expect(result.pubkey).toBe(PK)
    expect(result.relays).toEqual(['wss://r'])
    expect(await discovery.verifyNip05('alice@example.com', PK, fakeFetch)).toBe(true)
    expect(await discovery.verifyNip05('alice@example.com', 'ff'.repeat(32), fakeFetch)).toBe(false)
  })
  test('resolveNip05 rejects bad identifier + non-OK + missing name', async () => {
    await expect(discovery.resolveNip05('bad')).rejects.toThrow('invalid NIP-05')
    const fail = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(discovery.resolveNip05('a@b.com', fail)).rejects.toThrow('404')
    const empty = (async () => ({ ok: true, json: async () => ({ names: {} }) })) as unknown as typeof fetch
    expect((await discovery.resolveNip05('a@b.com', empty)).pubkey).toBeUndefined()
  })
  test('relayListMetadata builds read/write markers', () => {
    const e = discovery.relayListMetadata([
      { url: 'wss://both' },
      { url: 'wss://r', read: true, write: false },
      { url: 'wss://w', read: false, write: true },
    ])
    expect(e.kind).toBe(10002)
    expect(e.tags).toContainEqual(['r', 'wss://both'])
    expect(e.tags).toContainEqual(['r', 'wss://r', 'read'])
    expect(e.tags).toContainEqual(['r', 'wss://w', 'write'])
  })
  test('handler recommendation + info parse', () => {
    const rec = discovery.handlerRecommendation(30023, '31990:abc:1', 'wss://r')
    expect(rec.kind).toBe(31989)
    expect(rec.tags).toContainEqual(['d', '30023'])
    const info = sign({ kind: 31990, tags: [['k', '30023'], ['k', '30024']], content: '{"name":"Blogstr"}' })
    const parsed = discovery.parseHandlerInfo(info)
    expect(parsed.kinds).toEqual([30023, 30024])
    expect(parsed.name).toBe('Blogstr')
    expect(discovery.parseHandlerInfo(sign({ kind: 31990, tags: [], content: 'not json' })).name).toBeUndefined()
  })
})

describe('extra cluster', () => {
  test('searchFilter, appData, status', () => {
    expect(extra.searchFilter('bitcoin', { kinds: [1] })).toEqual({ kinds: [1], search: 'bitcoin' })
    const ad = extra.appData('my-app', '{"theme":"dark"}')
    expect(ad.kind).toBe(30078)
    expect(extra.parseAppData(sign(ad))).toEqual({ appId: 'my-app', data: '{"theme":"dark"}' })
    expect(extra.status('music', 'Now playing', 9999).tags).toContainEqual(['expiration', '9999'])
  })
  test('highlight, comment', () => {
    const h = extra.highlight('great quote', { eventId: ID, author: PK })
    expect(h.kind).toBe(9802)
    expect(h.tags).toContainEqual(['e', ID])
    expect(extra.highlight('q', { url: 'https://x' }).tags).toContainEqual(['r', 'https://x'])
    const c = extra.comment('nice', { id: ID, kind: 1, pubkey: PK })
    expect(c.kind).toBe(1111)
    expect(c.tags).toContainEqual(['E', ID])
    expect(c.tags).toContainEqual(['e', ID])
    const nested = extra.comment('reply', { id: ID, kind: 1, pubkey: PK }, { id: 'cd'.repeat(32), kind: 1111, pubkey: PK })
    expect(nested.tags).toContainEqual(['e', 'cd'.repeat(32)])
  })
  test('channels, polls', () => {
    expect(extra.createChannel({ name: 'general', about: 'chat' }).kind).toBe(40)
    expect(extra.channelMessage(ID, 'hi').tags).toContainEqual(['e', ID, '', 'root'])
    const p = extra.poll({ question: 'A or B?', options: [{ id: '1', label: 'A' }, { id: '2', label: 'B' }], multiple: true, endsAt: 100 })
    expect(p.kind).toBe(1068)
    expect(p.tags).toContainEqual(['option', '1', 'A'])
    expect(p.tags).toContainEqual(['polltype', 'multiplechoice'])
    expect(extra.poll({ question: 'q', options: [] }).tags).toContainEqual(['polltype', 'singlechoice'])
    expect(extra.pollResponse(ID, ['1', '2']).tags).toContainEqual(['response', '1'])
  })
  test('classified listing, protected, expiration, subject', () => {
    const l = extra.classifiedListing({ slug: 'bike', title: 'Used bike', summary: 's', price: { amount: '100', currency: 'USD' }, images: ['https://i'], description: 'a bike' })
    expect(l.kind).toBe(30402)
    expect(l.tags).toContainEqual(['price', '100', 'USD'])
    expect(l.tags).toContainEqual(['image', 'https://i'])

    expect(extra.isProtected(sign(extra.asProtected({ kind: 1, content: 'x', tags: [] })))).toBe(true)
    expect(extra.isProtected(sign({ kind: 1, content: 'x', tags: [] }))).toBe(false)
    expect(extra.withExpiration({ kind: 1, content: 'x', tags: [] }, 123).tags).toContainEqual(['expiration', '123'])
    expect(extra.withSubject({ kind: 1, content: 'x', tags: [] }, 'Re: hi').tags).toContainEqual(['subject', 'Re: hi'])
  })
})
