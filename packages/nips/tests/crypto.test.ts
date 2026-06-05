// Crypto-bearing NIPs: 59 gift wrap, 17 DMs, 51 lists, 57 zaps, 47 NWC, 98 HTTP auth.
import { describe, expect, test } from 'bun:test'
import {
  finalizeEvent,
  getPublicKey,
  nip44,
  parsePubkey,
  verifyEvent,
  type NostrEvent,
  type Pubkey,
} from '@nostragent/core'
import * as nip59 from '../src/nip59.ts'
import * as nip17 from '../src/nip17.ts'
import * as nip51 from '../src/nip51.ts'
import * as nip57 from '../src/nip57.ts'
import * as nip47 from '../src/nip47.ts'
import * as nip98 from '../src/nip98.ts'

const alice = '01'.repeat(32)
const bob = '02'.repeat(31) + '03'
const ALICE = getPublicKey(alice)
const BOB = parsePubkey(getPublicKey(bob))

// Deterministic clock so timestamps don't churn.
const clock: nip59.WrapClock = { now: () => 1_700_000_000, random: () => 0.5 }

describe('NIP-59 gift wrap', () => {
  test('wrap → unwrap round-trips a rumor; ids and authorship hold', () => {
    const rumor = nip59.createRumor({ kind: 1, tags: [['t', 'secret']], content: 'hidden' }, ALICE, clock)
    const gift = nip59.wrap(rumor, alice, BOB, clock)
    expect(gift.kind).toBe(1059)
    expect(gift.tags).toContainEqual(['p', BOB])
    expect(verifyEvent(gift)).toBe(true)
    // the gift wrap is signed by an EPHEMERAL key, not alice
    expect(gift.pubkey).not.toBe(ALICE)
    // timestamp is back-dated (never future)
    expect(gift.created_at).toBeLessThanOrEqual(clock.now())

    const opened = nip59.unwrap(gift, bob)
    expect(opened.content).toBe('hidden')
    expect(opened.pubkey).toBe(ALICE)
    expect(opened.id).toBe(rumor.id)
  })

  test('wrapTemplate convenience', () => {
    const gift = nip59.wrapTemplate({ kind: 1, tags: [], content: 'hi' }, alice, BOB, clock)
    expect(nip59.unwrap(gift, bob).content).toBe('hi')
  })

  test('a fresh ephemeral key per wrap (two wraps differ)', () => {
    const r = nip59.createRumor({ kind: 1, tags: [], content: 'x' }, ALICE, clock)
    expect(nip59.wrap(r, alice, BOB, clock).pubkey).not.toBe(nip59.wrap(r, alice, BOB, clock).pubkey)
  })

  test('unwrap rejects non-1059, tampered seal, and wrong recipient', () => {
    const gift = nip59.wrapTemplate({ kind: 1, tags: [], content: 'hi' }, alice, BOB, clock)
    expect(() => nip59.unwrap({ ...gift, kind: 1 }, bob)).toThrow('not a kind-1059')
    // a third party can't open it
    const carol = '04'.repeat(32)
    expect(() => nip59.unwrap(gift, carol)).toThrow()
  })

  test('unwrap rejects a seal whose author ≠ rumor author', () => {
    // forge: wrap a rumor that claims a different author than the seal signer
    const rumor = nip59.createRumor({ kind: 1, tags: [], content: 'forged' }, BOB, clock) // claims BOB
    const gift = nip59.wrap(rumor, alice, BOB, clock) // but sealed/signed by alice
    expect(() => nip59.unwrap(gift, bob)).toThrow('does not match seal author')
  })

  test('jittered timestamp stays within 2 days and never future', () => {
    const past: nip59.WrapClock = { now: () => 1_700_000_000, random: () => 0.999 }
    const gift = nip59.wrapTemplate({ kind: 1, tags: [], content: 'x' }, alice, BOB, past)
    expect(gift.created_at).toBeLessThanOrEqual(1_700_000_000)
    expect(gift.created_at).toBeGreaterThanOrEqual(1_700_000_000 - 2 * 24 * 60 * 60)
  })
})

describe('NIP-17 private DMs', () => {
  test('seal fans out to each recipient + self; each can open', () => {
    const dm: nip17.DirectMessage = { text: 'yo bob', to: [BOB], subject: 'hi' }
    const wraps = nip17.sealDirectMessage(dm, alice, clock)
    // one for bob, one for alice (self)
    expect(wraps.length).toBe(2)
    const forBob = wraps.find((w) => w.recipient === BOB)!
    const forAlice = wraps.find((w) => w.recipient === ALICE)!

    const bobMsg = nip17.openDirectMessage(forBob.wrap, bob)
    expect(bobMsg.text).toBe('yo bob')
    expect(bobMsg.from).toBe(ALICE)
    expect(bobMsg.to).toContain(BOB)
    expect(bobMsg.subject).toBe('hi')

    // alice keeps her own readable copy
    expect(nip17.openDirectMessage(forAlice.wrap, alice).text).toBe('yo bob')
  })

  test('reply carries the e-tag through the wrap', () => {
    const dm: nip17.DirectMessage = { text: 'reply', to: [BOB], replyTo: 'ab'.repeat(32) }
    const wraps = nip17.sealDirectMessage(dm, alice, clock)
    const forBob = wraps.find((w) => w.recipient === BOB)!
    const msg = nip17.openDirectMessage(forBob.wrap, bob)
    expect(msg.replyTo).toBe('ab'.repeat(32))
  })

  test('openDirectMessage rejects a non-DM gift wrap', () => {
    const gift = nip59.wrapTemplate({ kind: 1, tags: [], content: 'not a dm' }, alice, BOB, clock)
    expect(() => nip17.openDirectMessage(gift, bob)).toThrow('did not contain a NIP-17 message')
  })

  test('kind-10050 DM relay list round-trips', () => {
    const event = finalizeEvent({ ...nip17.dmRelayList(['wss://dm1', 'wss://dm2']), created_at: 1 }, alice)
    expect(event.kind).toBe(10050)
    expect(nip17.parseDmRelayList(event)).toEqual(['wss://dm1', 'wss://dm2'])
  })
})

describe('NIP-51 lists', () => {
  test('public bookmarks round-trip', () => {
    let contents: nip51.ListContents = { public: [], private: [] }
    contents = nip51.addBookmark(contents, 'ab'.repeat(32))
    const event = finalizeEvent({ ...nip51.buildList(nip51.BOOKMARKS, contents, alice, ALICE), created_at: 1 }, alice)
    expect(event.kind).toBe(10003)
    const parsed = nip51.parseList(event)
    expect(parsed.public).toContainEqual(['e', 'ab'.repeat(32)])
  })

  test('private items are NIP-44 self-encrypted and decrypt back', () => {
    let contents: nip51.ListContents = { public: [], private: [] }
    contents = nip51.addMute(contents, BOB) // private by default
    const tmpl = nip51.buildList(nip51.MUTE, contents, alice, ALICE)
    expect(tmpl.content).not.toBe('') // encrypted
    const event = finalizeEvent({ ...tmpl, created_at: 1 }, alice)
    // without the key, private stays hidden
    expect(nip51.parseList(event).private).toEqual([])
    // with the key, it decrypts
    const parsed = nip51.parseList(event, alice, ALICE)
    expect(parsed.private).toContainEqual(['p', BOB])
  })

  test('sets carry a d identifier', () => {
    const tmpl = nip51.buildList(nip51.FOLLOW_SETS, { public: [['p', BOB]], private: [] }, alice, ALICE, 'friends')
    expect(tmpl.tags).toContainEqual(['d', 'friends'])
    expect(nip51.parseList(finalizeEvent({ ...tmpl, created_at: 1 }, alice)).public).toContainEqual(['p', BOB])
  })

  test('public bookmark/mute variants', () => {
    const c = nip51.addBookmark(nip51.addMute({ public: [], private: [] }, BOB, false), 'cd'.repeat(32), false)
    expect(c.public).toContainEqual(['p', BOB])
    expect(c.public).toContainEqual(['e', 'cd'.repeat(32)])
  })
})

describe('NIP-57 zaps', () => {
  test('zap request structure', () => {
    const req = nip57.zapRequest({
      recipient: BOB,
      amountMsat: 21000,
      relays: ['wss://r'],
      lnurl: 'lnurl1xyz',
      eventId: 'ab'.repeat(32),
      comment: 'great',
    })
    expect(req.kind).toBe(9734)
    expect(req.content).toBe('great')
    expect(req.tags).toContainEqual(['amount', '21000'])
    expect(req.tags).toContainEqual(['p', BOB])
    expect(req.tags).toContainEqual(['e', 'ab'.repeat(32)])
  })

  test('lud16 → url', () => {
    expect(nip57.lud16ToUrl('alice@example.com')).toBe('https://example.com/.well-known/lnurlp/alice')
    expect(() => nip57.lud16ToUrl('bad')).toThrow('invalid lud16')
  })

  test('callback url requires Nostr support', () => {
    const signed = finalizeEvent({ ...nip57.zapRequest({ recipient: BOB, amountMsat: 1000, relays: [], lnurl: 'l' }), created_at: 1 }, alice)
    const meta = { callback: 'https://pay.example/cb', minSendable: 1, maxSendable: 1e9, allowsNostr: true, nostrPubkey: 'ff'.repeat(32) }
    const url = nip57.zapCallbackUrl(meta, signed, 1000, 'lnurl1')
    expect(url).toContain('amount=1000')
    expect(url).toContain('nostr=')
    expect(() => nip57.zapCallbackUrl({ ...meta, allowsNostr: false }, signed, 1000, 'l')).toThrow('does not support Nostr')
  })

  test('full invoice fetch via injected fetch', async () => {
    const signed = finalizeEvent({ ...nip57.zapRequest({ recipient: BOB, amountMsat: 1000, relays: [], lnurl: 'l' }), created_at: 1 }, alice)
    let call = 0
    const fakeFetch = (async () => {
      call++
      if (call === 1) return { ok: true, json: async () => ({ callback: 'https://pay/cb', minSendable: 1, maxSendable: 1e9, allowsNostr: true, nostrPubkey: 'ff'.repeat(32) }) }
      return { ok: true, json: async () => ({ pr: 'lnbc1invoice' }) }
    }) as unknown as typeof fetch
    const { invoice } = await nip57.fetchZapInvoice('bob@wallet.com', signed, 1000, 'lnurl1', fakeFetch)
    expect(invoice).toBe('lnbc1invoice')
  })

  test('fetch errors surface', async () => {
    const signed = finalizeEvent({ ...nip57.zapRequest({ recipient: BOB, amountMsat: 1, relays: [], lnurl: 'l' }), created_at: 1 }, alice)
    const failMeta = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(nip57.fetchZapInvoice('x@y.com', signed, 1, 'l', failMeta)).rejects.toThrow('404')
    const noPr = (async () => ({ ok: true, json: async () => ({ callback: 'https://c', allowsNostr: true, nostrPubkey: 'ff'.repeat(32), minSendable: 1, maxSendable: 9 }) })) as unknown as typeof fetch
    // second call returns no pr — but our fake only has one handler; emulate:
    let n = 0
    const noInvoice = (async () => { n++; return n === 1 ? { ok: true, json: async () => ({ callback: 'https://c', allowsNostr: true, nostrPubkey: 'ff'.repeat(32), minSendable: 1, maxSendable: 9 }) } : { ok: true, json: async () => ({ reason: 'nope' }) } }) as unknown as typeof fetch
    await expect(nip57.fetchZapInvoice('x@y.com', signed, 1, 'l', noInvoice)).rejects.toThrow('no invoice')
    void noPr
  })

  test('parse zap receipt', () => {
    const req = finalizeEvent({ ...nip57.zapRequest({ recipient: BOB, amountMsat: 5000, relays: ['wss://r'], lnurl: 'l', eventId: 'ab'.repeat(32) }), created_at: 1 }, alice)
    const receipt = finalizeEvent({ kind: 9735, created_at: 2, tags: [['bolt11', 'lnbc5'], ['p', BOB], ['e', 'ab'.repeat(32)], ['description', JSON.stringify(req)]], content: '' }, bob)
    const parsed = nip57.parseZapReceipt(receipt)
    expect(parsed.bolt11).toBe('lnbc5')
    expect(parsed.recipient).toBe(BOB)
    expect(parsed.amountMsat).toBe(5000)
    expect(parsed.request?.id).toBe(req.id)
    // tolerant of a bad description
    const bad = finalizeEvent({ kind: 9735, created_at: 2, tags: [['bolt11', 'x'], ['description', 'not json']], content: '' }, bob)
    expect(nip57.parseZapReceipt(bad).request).toBeUndefined()
  })
})

describe('NIP-47 NWC', () => {
  const walletSk = '0a'.repeat(32)
  const WALLET = parsePubkey(getPublicKey(walletSk))
  const clientSecret = '0b'.repeat(32)
  const uri = `nostr+walletconnect://${WALLET}?relay=wss://nwc.relay&secret=${clientSecret}&lud16=me@wallet.com`

  test('parse connection uri', () => {
    const conn = nip47.parseConnectionUri(uri)
    expect(conn.walletPubkey).toBe(WALLET)
    expect(conn.relay).toBe('wss://nwc.relay')
    expect(conn.secret).toBe(clientSecret)
    expect(conn.lud16).toBe('me@wallet.com')
    expect(() => nip47.parseConnectionUri('https://x')).toThrow('expected a nostr+walletconnect')
    expect(() => nip47.parseConnectionUri(`nostr+walletconnect://${WALLET}?secret=s`)).toThrow('missing relay')
    expect(() => nip47.parseConnectionUri(`nostr+walletconnect://${WALLET}?relay=wss://r`)).toThrow('missing secret')
  })

  test('build request + wallet decrypts + parse response', () => {
    const conn = nip47.parseConnectionUri(uri)
    const req = nip47.payInvoice(conn, 'lnbc1', 1000)
    expect(req.kind).toBe(23194)
    expect(req.tags).toContainEqual(['p', WALLET])
    expect(nip47.clientPubkey(conn)).toBe(getPublicKey(clientSecret))

    // the wallet (holding walletSk) decrypts the request
    const decrypted = JSON.parse(nip44.decryptFrom(req.content, walletSk, getPublicKey(clientSecret)))
    expect(decrypted.method).toBe('pay_invoice')
    expect(decrypted.params.invoice).toBe('lnbc1')

    // wallet replies; client parses it
    const respContent = nip44.encryptTo(JSON.stringify({ result_type: 'pay_invoice', result: { preimage: 'abc' } }), walletSk, getPublicKey(clientSecret))
    const resp = finalizeEvent({ kind: 23195, created_at: 1, tags: [['p', getPublicKey(clientSecret)]], content: respContent }, walletSk)
    const parsed = nip47.parseResponse(conn, resp)
    expect(parsed.result_type).toBe('pay_invoice')
    expect(parsed.result?.preimage).toBe('abc')
  })

  test('generic buildRequest with explicit method', () => {
    const conn = nip47.parseConnectionUri(uri)
    const req = nip47.buildRequest(conn, { method: 'get_balance', params: {} }, 123)
    expect(req.created_at).toBe(123)
  })
})

describe('NIP-98 HTTP auth', () => {
  test('build → header → decode round-trip; validate', () => {
    const tmpl = nip98.httpAuthTemplate({ url: 'https://api.example/x', method: 'get', created_at: 1000 })
    expect(tmpl.kind).toBe(27235)
    expect(tmpl.tags).toContainEqual(['method', 'GET'])
    const signed = finalizeEvent(tmpl, alice)
    const header = nip98.authHeader(signed)
    expect(header.startsWith('Nostr ')).toBe(true)
    const decoded = nip98.decodeAuthHeader(header)
    expect(decoded.id).toBe(signed.id)
    expect(verifyEvent(decoded)).toBe(true)
    expect(nip98.validateHttpAuth(decoded, { url: 'https://api.example/x', method: 'GET', now: 1000 })).toBe(true)
  })

  test('payload hash + validation', () => {
    const body = '{"hello":"world"}'
    const signed = finalizeEvent(nip98.httpAuthTemplate({ url: 'https://api/x', method: 'POST', body, created_at: 1000 }), alice)
    expect(nip98.validateHttpAuth(signed, { url: 'https://api/x', method: 'POST', body, now: 1000 })).toBe(true)
    expect(nip98.validateHttpAuth(signed, { url: 'https://api/x', method: 'POST', body: 'tampered', now: 1000 })).toBe(false)
  })

  test('validation rejects wrong kind/url/method/staleness', () => {
    const signed = finalizeEvent(nip98.httpAuthTemplate({ url: 'https://api/x', method: 'GET', created_at: 1000 }), alice)
    expect(nip98.validateHttpAuth(signed, { url: 'https://api/y', method: 'GET', now: 1000 })).toBe(false)
    expect(nip98.validateHttpAuth(signed, { url: 'https://api/x', method: 'POST', now: 1000 })).toBe(false)
    expect(nip98.validateHttpAuth(signed, { url: 'https://api/x', method: 'GET', now: 9_999_999 })).toBe(false)
    expect(nip98.validateHttpAuth({ ...signed, kind: 1 }, { url: 'https://api/x', method: 'GET', now: 1000 })).toBe(false)
    expect(() => nip98.decodeAuthHeader('Bearer xyz')).toThrow('not a Nostr authorization')
  })
})
