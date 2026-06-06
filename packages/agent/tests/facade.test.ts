// Facade regression suite: the NostrClient surface the CLI depends on.
import { afterEach, describe, expect, test } from 'bun:test'
import { createIdentity, finalizeEvent, hexToBytes, loadIdentity, utf8ToBytes, verifyEvent, type Identity, type NostrEvent } from '@hopstr/core'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { cbc } from '@noble/ciphers/aes.js'
import { base64 } from '@scure/base'
import { NostrClient, DEFAULT_RELAYS } from '../src/facade.ts'
import { startRelay, type MockRelay } from './relay-harness.ts'

// Build a signed legacy kind-4 DM from `sender` to `recipientPk`, the way old
// NIP-04 clients did (AES-256-CBC; shared key = X coord of the ECDH secret).
function legacyDM(sender: Identity, recipientPk: string, text: string): NostrEvent {
  const shared = secp256k1.getSharedSecret(sender.secretKey, hexToBytes('02' + recipientPk)).subarray(1, 33)
  const iv = new Uint8Array(16).fill(7)
  const ct = cbc(shared, iv).encrypt(utf8ToBytes(text))
  const content = `${base64.encode(ct)}?iv=${base64.encode(iv)}`
  return finalizeEvent({ kind: 4, content, tags: [['p', recipientPk]] }, sender.secretKey)
}

const relays: MockRelay[] = []
function relay(seed: NostrEvent[] = []): MockRelay {
  const r = startRelay(seed)
  relays.push(r)
  return r
}
afterEach(() => {
  while (relays.length) relays.pop()!.stop()
})

function client(): { alice: NostrClient; r: MockRelay } {
  const r = relay()
  const alice = new NostrClient(createIdentity(), [r.url])
  return { alice, r }
}

describe('identity', () => {
  test('exposes pubkey/npub; DEFAULT_RELAYS present', () => {
    const id = createIdentity()
    const c = new NostrClient(id)
    expect(c.pubkey).toBe(id.pubkey)
    expect(c.npub).toBe(id.npub)
    expect(DEFAULT_RELAYS.length).toBe(4)
    c.close()
  })
  test('createIdentity/loadIdentity re-exported', () => {
    const id = createIdentity()
    expect(loadIdentity(id.nsec).pubkey).toBe(id.pubkey)
  })
})

describe('posting', () => {
  test('post returns {ok,id} and the note is on the relay', async () => {
    const { alice, r } = client()
    const res = await alice.post('gm', [['t', 'coffee']])
    expect(res.ok).toBe(true)
    expect(res.id).toMatch(/^[0-9a-f]{64}$/)
    const stored = r.stored.find((e) => e.id === res.id)!
    expect(stored.content).toBe('gm')
    expect(stored.tags).toContainEqual(['t', 'coffee'])
    alice.close()
  })

  test('reply roots a thread (NIP-10)', async () => {
    const { alice, r } = client()
    const post = await alice.post('original')
    const reply = await alice.reply(post.id, 'nice!')
    const stored = r.stored.find((e) => e.id === reply.id)!
    expect(stored.tags.some((t) => t[0] === 'e' && t[1] === post.id && t[3] === 'root')).toBe(true)
    expect(stored.tags).toContainEqual(['p', alice.pubkey])
    alice.close()
  })

  test('reply/react/repost throw when the target is missing', async () => {
    const { alice } = client()
    await expect(alice.reply('ab'.repeat(32), 'x')).rejects.toThrow('not found')
    await expect(alice.react('ab'.repeat(32))).rejects.toThrow('not found')
    await expect(alice.repost('ab'.repeat(32))).rejects.toThrow('not found')
    alice.close()
  })

  test('react (+ and emoji) and repost', async () => {
    const { alice, r } = client()
    const post = await alice.post('react to me')
    const like = await alice.react(post.id)
    expect(r.stored.find((e) => e.id === like.id)?.kind).toBe(7)
    const fire = await alice.react(post.id, '🔥')
    expect(r.stored.find((e) => e.id === fire.id)?.content).toBe('🔥')
    const boost = await alice.repost(post.id)
    expect(r.stored.find((e) => e.id === boost.id)?.kind).toBe(6)
    alice.close()
  })
})

describe('reading', () => {
  test('feed returns FeedNotes newest-first', async () => {
    const { alice, r } = client()
    await alice.post('first')
    await alice.post('second')
    const feed = await alice.feed({ limit: 10 })
    expect(feed.length).toBeGreaterThanOrEqual(2)
    expect(feed[0]!.created_at).toBeGreaterThanOrEqual(feed[1]!.created_at)
    expect(feed[0]).toHaveProperty('author')
    expect(feed[0]).toHaveProperty('content')
    // feed by authors
    const byAuthor = await alice.feed({ authors: [alice.pubkey] })
    expect(byAuthor.every((n) => n.author === alice.pubkey)).toBe(true)
    void r
    alice.close()
  })

  test('hashtag filters by #t', async () => {
    const { alice } = client()
    await alice.post('bitcoin fixes this', [['t', 'bitcoin']])
    await alice.post('unrelated')
    const tagged = await alice.hashtag('bitcoin')
    expect(tagged.some((n) => n.content.includes('bitcoin'))).toBe(true)
    const withHash = await alice.hashtag('#bitcoin') // leading # tolerated
    expect(withHash.length).toBe(tagged.length)
    alice.close()
  })

  test('mentions excludes your own notes', async () => {
    const r = relay()
    const alice = new NostrClient(createIdentity(), [r.url])
    const bob = new NostrClient(createIdentity(), [r.url])
    await bob.post(`hey ${alice.npub}`, [['p', alice.pubkey]])
    await alice.post('my own note mentioning me', [['p', alice.pubkey]])
    const mentions = await alice.mentions()
    expect(mentions.some((n) => n.author === bob.pubkey)).toBe(true)
    expect(mentions.every((n) => n.author !== alice.pubkey)).toBe(true)
    alice.close()
    bob.close()
  })
})

describe('social graph', () => {
  test('follow / following / unfollow', async () => {
    const r = relay()
    const alice = new NostrClient(createIdentity(), [r.url])
    const bobPk = createIdentity().pubkey
    const carolPk = createIdentity().pubkey
    await alice.follow(bobPk)
    await alice.follow(carolPk)
    let follows = await alice.following()
    expect(follows).toContain(bobPk)
    expect(follows).toContain(carolPk)
    await alice.unfollow(bobPk)
    follows = await alice.following()
    expect(follows).not.toContain(bobPk)
    expect(follows).toContain(carolPk)
    // someone else's follows (empty here)
    expect(await alice.following(bobPk)).toEqual([])
    alice.close()
  })
})

describe('profile', () => {
  test('setProfile / getProfile round-trip', async () => {
    const { alice } = client()
    await alice.setProfile({ name: 'alice', about: 'velvet dev' })
    const profile = await alice.getProfile(alice.pubkey)
    expect(profile?.name).toBe('alice')
    // unknown profile → null
    expect(await alice.getProfile(createIdentity().pubkey)).toBeNull()
    alice.close()
  })

  test('getProfile by npub + malformed content → {}', async () => {
    const { alice } = client()
    await alice.publish({ kind: 0, content: 'not json', tags: [] })
    expect(await alice.getProfile(alice.npub)).toEqual({})
    alice.close()
  })
})

describe('bootstrap (network presence)', () => {
  test('publishes all four presence events on a fresh identity', async () => {
    const { alice, r } = client()
    const res = await alice.bootstrap()

    // every step succeeded with a published event (nothing pre-existed)
    expect(res.relayList.ok).toBe(true)
    expect(res.dmRelays.ok).toBe(true)
    expect(res.profile).not.toBe('exists')
    expect(res.contacts).not.toBe('exists')

    // the relay now holds kind 0, 3, 10002, 10050 for alice
    const kinds = new Set(r.stored.filter((e) => e.pubkey === alice.pubkey).map((e) => e.kind))
    expect(kinds.has(0)).toBe(true)
    expect(kinds.has(3)).toBe(true)
    expect(kinds.has(10002)).toBe(true)
    expect(kinds.has(10050)).toBe(true)

    // kind-10050 lists our relay so senders know where to deliver DMs
    const dmList = r.stored.find((e) => e.kind === 10050 && e.pubkey === alice.pubkey)!
    expect(dmList.tags).toContainEqual(['relay', r.url])
    alice.close()
  })

  test('does not overwrite an existing profile or contact list', async () => {
    const { alice, r } = client()
    // alice already has a real profile and a non-empty follow list
    await alice.setProfile({ name: 'real-name', about: 'do not clobber' })
    const friend = createIdentity().pubkey
    await alice.follow(friend)

    const res = await alice.bootstrap()
    expect(res.profile).toBe('exists')
    expect(res.contacts).toBe('exists')

    // the real profile + follow survived
    expect((await alice.getProfile(alice.pubkey))?.name).toBe('real-name')
    expect(await alice.following()).toContain(friend)
    void r
    alice.close()
  })
})

describe('NIP-17 DMs', () => {
  test('sendDM → readDMs round-trips between two clients', async () => {
    const r = relay()
    const alice = new NostrClient(createIdentity(), [r.url])
    const bob = new NostrClient(createIdentity(), [r.url])

    const sent = await alice.sendDM(bob.npub, 'hey bob, this is private')
    expect(sent.ok).toBe(true)

    // bob reads the conversation with alice
    const bobView = await bob.readDMs(alice.pubkey)
    expect(bobView.some((m) => m.text === 'hey bob, this is private' && m.from === alice.pubkey)).toBe(true)

    // alice also has her own readable copy (self-wrap)
    const aliceView = await alice.readDMs(bob.pubkey)
    expect(aliceView.some((m) => m.text === 'hey bob, this is private')).toBe(true)

    // the gift wrap on the relay is kind 1059 and NOT signed by alice
    const wraps = r.stored.filter((e) => e.kind === 1059)
    expect(wraps.length).toBeGreaterThanOrEqual(2) // bob + self
    expect(wraps.every((w) => verifyEvent(w))).toBe(true)
    expect(wraps.every((w) => w.pubkey !== alice.pubkey)).toBe(true)

    alice.close()
    bob.close()
  })

  test('readDMs ignores unreadable wraps and returns empty for no convo', async () => {
    const { alice } = client()
    expect(await alice.readDMs(createIdentity().pubkey)).toEqual([])
    alice.close()
  })

  test('decryptLegacyDM recovers plaintext from an incoming kind-4', () => {
    const me = createIdentity()
    const sender = createIdentity()
    const alice = new NostrClient(me, ['ws://unused'])
    const event = legacyDM(sender, me.pubkey, 'hey, this is a legacy DM')
    expect(alice.decryptLegacyDM(event)).toBe('hey, this is a legacy DM')
    alice.close()
  })

  test('decryptLegacyDM returns null for a DM not addressed to us', () => {
    const me = createIdentity()
    const sender = createIdentity()
    const someoneElse = createIdentity()
    const alice = new NostrClient(me, ['ws://unused'])
    const event = legacyDM(sender, someoneElse.pubkey, 'not for you')
    expect(alice.decryptLegacyDM(event)).toBeNull()
    alice.close()
  })
})

describe('low-level passthrough', () => {
  test('publish / query / queryOne / subscribe', async () => {
    const { alice, r } = client()
    const pub = await alice.publish({ kind: 1, content: 'raw', tags: [] })
    expect(pub.ok).toBe(true)
    const found = await alice.query({ ids: [pub.id] })
    expect(found[0]?.content).toBe('raw')
    expect((await alice.queryOne({ ids: [pub.id] }))?.id as string).toBe(pub.id)

    const seen: string[] = []
    const stop = alice.subscribe({ kinds: [1], authors: [alice.pubkey] }, (e) => seen.push(e.id))
    await new Promise((r2) => setTimeout(r2, 30))
    stop()
    expect(seen.length).toBeGreaterThan(0)
    void r
    alice.close()
  })
})
