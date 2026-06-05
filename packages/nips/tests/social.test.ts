// Social NIPs: 02 follows, 09 deletion, 10 threads, 18 reposts, 23 long-form,
// 25 reactions, 27 mentions.
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, nip19, type NostrEvent } from '@nostragent/core'
import * as nip02 from '../src/nip02.ts'
import * as nip09 from '../src/nip09.ts'
import * as nip10 from '../src/nip10.ts'
import * as nip18 from '../src/nip18.ts'
import * as nip23 from '../src/nip23.ts'
import * as nip25 from '../src/nip25.ts'
import * as nip27 from '../src/nip27.ts'

const SK = '01'.repeat(32)
const PK = getPublicKey(SK)
const PK2 = getPublicKey('02'.repeat(31) + '03')
const ID = 'ab'.repeat(32)

const sign = (t: { kind: number; tags: string[][]; content: string; created_at?: number }): NostrEvent =>
  finalizeEvent({ created_at: 1, ...t }, SK)

describe('NIP-02 follows', () => {
  test('round-trips follows with relay + petname', () => {
    const follows = [{ pubkey: PK }, { pubkey: PK2, relay: 'wss://r', petname: 'bob' }]
    const event = sign(nip02.followList(follows))
    const parsed = nip02.parseFollowList(event)
    expect(parsed[0]).toEqual({ pubkey: PK })
    expect(parsed[1]).toEqual({ pubkey: PK2, relay: 'wss://r', petname: 'bob' })
    expect(nip02.followedPubkeys(event)).toEqual([PK, PK2])
  })
  test('petname without relay still emits a relay slot', () => {
    const event = sign(nip02.followList([{ pubkey: PK, petname: 'me' }]))
    expect(nip02.parseFollowList(event)[0]).toEqual({ pubkey: PK, petname: 'me' })
  })
})

describe('NIP-09 deletion', () => {
  test('builds e/a deletions and parses targets', () => {
    expect(nip09.deleteEvents([ID], 'spam').tags).toEqual([['e', ID]])
    expect(nip09.deleteAddresses(['30023:x:y']).tags).toEqual([['a', '30023:x:y']])
    const note = sign({ kind: 1, tags: [], content: 'x' })
    const article = sign({ kind: 30023, tags: [['d', 'slug']], content: 'a' })
    const del = nip09.deleteEventObjects([note, article], 'cleanup')
    expect(del.tags).toContainEqual(['e', note.id])
    expect(del.tags).toContainEqual(['a', `30023:${PK}:slug`])
    const parsed = nip09.parseDeletion(sign(del))
    expect(parsed.ids).toContain(note.id)
    expect(parsed.addresses).toContain(`30023:${PK}:slug`)
    expect(parsed.reason).toBe('cleanup')
  })
})

describe('NIP-10 threads', () => {
  test('marked reply tags root a fresh thread then nest', () => {
    const root = sign({ kind: 1, tags: [], content: 'root' })
    const replyTags = nip10.replyTags(root)
    expect(replyTags).toContainEqual(['e', root.id, '', 'root'])
    expect(replyTags).toContainEqual(['p', root.pubkey])

    const reply = sign({ kind: 1, tags: replyTags, content: 'r1' })
    const nested = nip10.replyTags(reply, 'wss://r')
    // the root carries forward; the relay hint fills empty relay slots
    expect(nested).toContainEqual(['e', root.id, 'wss://r', 'root'])
    expect(nested).toContainEqual(['e', reply.id, 'wss://r', 'reply'])
  })
  test('parses marked, single positional, and multi positional', () => {
    const marked = sign({ kind: 1, tags: [['e', ID, '', 'root'], ['e', 'cd'.repeat(32), '', 'reply'], ['p', PK]], content: '' })
    const t = nip10.parseThread(marked)
    expect(t.root?.id).toBe(ID)
    expect(t.reply?.id).toBe('cd'.repeat(32))
    expect(t.participants).toEqual([PK])

    const single = sign({ kind: 1, tags: [['e', ID]], content: '' })
    expect(nip10.parseThread(single).root?.id).toBe(ID)

    const multi = sign({ kind: 1, tags: [['e', ID], ['e', 'cd'.repeat(32)], ['e', 'ef'.repeat(32)]], content: '' })
    const mt = nip10.parseThread(multi)
    expect(mt.root?.id).toBe(ID)
    expect(mt.reply?.id).toBe('ef'.repeat(32))
    expect(mt.mentions).toContain('cd'.repeat(32))
  })
})

describe('NIP-18 reposts', () => {
  test('repost, generic repost, quote, parse', () => {
    const note = sign({ kind: 1, tags: [], content: 'original' })
    const rp = nip18.repost(note, 'wss://r')
    expect(rp.kind).toBe(6)
    expect(rp.tags).toContainEqual(['e', note.id, 'wss://r'])
    const parsed = nip18.parseRepost(sign(rp))
    expect(parsed.id).toBe(note.id)
    expect(parsed.embedded?.content).toBe('original')

    const article = sign({ kind: 30023, tags: [['d', 's']], content: 'a' })
    expect(nip18.genericRepost(article).kind).toBe(16)
    expect(nip18.genericRepost(article).tags).toContainEqual(['k', '30023'])

    const q = nip18.quote('check this', note)
    expect(q.tags).toContainEqual(['q', note.id, '', note.pubkey])
  })
  test('parseRepost tolerates non-JSON content', () => {
    const parsed = nip18.parseRepost(sign({ kind: 6, tags: [['e', ID]], content: 'not json' }))
    expect(parsed.id).toBe(ID)
    expect(parsed.embedded).toBeUndefined()
  })
})

describe('NIP-23 long-form', () => {
  test('article round-trips all metadata', () => {
    const a = { slug: 'my-post', title: 'My Post', summary: 's', image: 'http://i', publishedAt: 100, hashtags: ['nostr'], markdown: '# hi' }
    const event = sign(nip23.article(a))
    expect(event.kind).toBe(30023)
    const parsed = nip23.parseArticle(event)
    expect(parsed).toEqual(a)
    expect(nip23.draft(a).kind).toBe(30024)
  })
  test('minimal article', () => {
    const event = sign(nip23.article({ slug: 'x', markdown: 'body' }))
    const parsed = nip23.parseArticle(event)
    expect(parsed.slug).toBe('x')
    expect(parsed.title).toBeUndefined()
  })
})

describe('NIP-25 reactions', () => {
  test('like, emoji, custom emoji, parse', () => {
    const note = sign({ kind: 1, tags: [], content: 'x' })
    const like = nip25.react(note)
    expect(like.content).toBe('+')
    expect(like.tags).toContainEqual(['e', note.id, ''])
    expect(like.tags).toContainEqual(['k', '1'])

    const fire = nip25.react(note, '🔥')
    expect(fire.content).toBe('🔥')

    const article = sign({ kind: 30023, tags: [['d', 's']], content: 'a' })
    expect(nip25.react(article).tags).toContainEqual(['a', `30023:${PK}:s`])

    const custom = nip25.customReact(note, 'pepe', 'http://pepe.png')
    expect(custom.content).toBe(':pepe:')
    expect(custom.tags).toContainEqual(['emoji', 'pepe', 'http://pepe.png'])

    const parsed = nip25.parseReaction(sign(like))
    expect(parsed.isLike).toBe(true)
    expect(parsed.eventId).toBe(note.id)
    expect(nip25.parseReaction(sign(nip25.react(note, '-'))).isDislike).toBe(true)
    expect(nip25.parseReaction(sign({ kind: 7, tags: [], content: '' })).isLike).toBe(true)
  })
})

describe('NIP-27 mentions', () => {
  test('finds references and derives tags', () => {
    const npub = nip19.encodeNpub(PK)
    const note = nip19.encodeNote(ID)
    const naddr = nip19.encodeNaddr({ identifier: 'slug', pubkey: PK2, kind: 30023 })
    const content = `hi nostr:${npub} see nostr:${note} and nostr:${naddr} and nostr:bogus`
    const refs = nip27.findReferences(content)
    expect(refs.length).toBe(3) // bogus is skipped
    const tags = nip27.referenceTags(content)
    expect(tags).toContainEqual(['p', PK])
    expect(tags).toContainEqual(['e', ID])
    expect(tags).toContainEqual(['a', `30023:${PK2}:slug`])
  })
  test('nprofile + nevent references', () => {
    const nprofile = nip19.encodeNprofile({ pubkey: PK })
    const nevent = nip19.encodeNevent({ id: ID })
    const tags = nip27.referenceTags(`nostr:${nprofile} nostr:${nevent} nostr:${nprofile}`)
    expect(tags).toContainEqual(['p', PK])
    expect(tags).toContainEqual(['e', ID])
    expect(tags.filter((t) => t[0] === 'p').length).toBe(1) // deduped
  })
  test('no references → empty', () => {
    expect(nip27.referenceTags('just text')).toEqual([])
  })
})
