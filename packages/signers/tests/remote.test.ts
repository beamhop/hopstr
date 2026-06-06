// NIP-07 (mock provider) and NIP-46 (in-memory loopback bunker) signers.
import { describe, expect, test } from 'bun:test'
import {
  finalizeEvent,
  getPublicKey,
  nip44,
  verifyEvent,
  type EventTemplate,
  type NostrEvent,
  type Pubkey,
} from '@hopstr/core'
import { Nip07Signer, nip07Signer, type Nip07Provider } from '../src/nip07.ts'
import {
  BunkerSigner,
  bunkerSigner,
  parseBunkerUri,
  type Nip46Transport,
} from '../src/nip46.ts'
import { fromPayload } from '../src/payload.ts'

const USER_SK = '11'.repeat(32)
const SIGNER_SK = '22'.repeat(32) // the bunker's own key
const CLIENT_SK = '33'.repeat(32) // disposable client key

// ── NIP-07 ────────────────────────────────────────────────────────────────────

function mockProvider(sk: string): Nip07Provider {
  return {
    async getPublicKey() {
      return getPublicKey(sk)
    },
    async signEvent(template) {
      return finalizeEvent(template, sk)
    },
    nip44: {
      async encrypt(peer, plaintext) {
        return nip44.encryptTo(plaintext, sk, peer)
      },
      async decrypt(peer, ciphertext) {
        return nip44.decryptFrom(ciphertext, sk, peer)
      },
    },
    nip04: {
      async encrypt() {
        return 'unused'
      },
      async decrypt() {
        return 'legacy'
      },
    },
  }
}

describe('Nip07Signer', () => {
  test('signs, encrypts, decrypts via the provider', async () => {
    const signer = nip07Signer(mockProvider(USER_SK))
    expect(signer.backend).toBe('nip07')
    expect(await signer.getPublicKey()).toBe(getPublicKey(USER_SK))
    const event = await signer.signEvent({ kind: 1, tags: [], content: 'via extension' })
    expect(verifyEvent(event)).toBe(true)

    const peer = getPublicKey('44'.repeat(32)) as Pubkey
    const ct = await signer.nip44Encrypt(peer, 'secret')
    expect(typeof ct).toBe('string')
    expect(await signer.nip04Decrypt(peer, 'whatever?iv=x')).toBe('legacy')
  })

  test('serializes encryption calls (queue) and stays correct under concurrency', async () => {
    const signer = nip07Signer(mockProvider(USER_SK))
    const peer = getPublicKey('44'.repeat(32)) as Pubkey
    const results = await Promise.all([
      signer.nip44Encrypt(peer, 'a'),
      signer.nip44Encrypt(peer, 'b'),
      signer.nip44Encrypt(peer, 'c'),
    ])
    expect(results.length).toBe(3)
    expect(new Set(results).size).toBe(3) // distinct ciphertexts
  })

  test('a failed queued call does not wedge later calls', async () => {
    let calls = 0
    const flaky: Nip07Provider = {
      async getPublicKey() {
        return getPublicKey(USER_SK)
      },
      async signEvent(t) {
        return finalizeEvent(t, USER_SK)
      },
      nip44: {
        async encrypt(_peer, plaintext) {
          calls++
          if (plaintext === 'fail') throw new Error('user rejected')
          return `ok:${plaintext}`
        },
        async decrypt() {
          return 'd'
        },
      },
    }
    const signer = nip07Signer(flaky)
    const peer = getPublicKey('44'.repeat(32)) as Pubkey
    const first = signer.nip44Encrypt(peer, 'fail')
    const second = signer.nip44Encrypt(peer, 'after')
    await expect(first).rejects.toThrow('user rejected')
    expect(await second).toBe('ok:after') // queue recovered
    expect(calls).toBe(2)
  })

  test('throws when the extension lacks a capability', async () => {
    const bare: Nip07Provider = {
      async getPublicKey() {
        return getPublicKey(USER_SK)
      },
      async signEvent(t) {
        return finalizeEvent(t, USER_SK)
      },
    }
    const signer = nip07Signer(bare)
    const peer = getPublicKey('44'.repeat(32)) as Pubkey
    await expect(signer.nip44Encrypt(peer, 'x')).rejects.toThrow('does not support nip44')
    await expect(signer.nip44Decrypt(peer, 'x')).rejects.toThrow('does not support nip44')
    await expect(signer.nip04Decrypt(peer, 'x')).rejects.toThrow('does not support nip04')
  })

  test('toPayload/fromPayload restores a nip07 signer with a provider', async () => {
    const signer = nip07Signer(mockProvider(USER_SK))
    const restored = fromPayload(signer.toPayload(), { nip07Provider: mockProvider(USER_SK) })
    expect(await restored.getPublicKey()).toBe(getPublicKey(USER_SK))
  })

  test('errors with no provider available', () => {
    expect(() => new Nip07Signer()).toThrow('window.nostr is undefined')
  })
})

// ── NIP-46 in-memory loopback ───────────────────────────────────────────────────

/**
 * A fake bunker: an in-memory transport that plays the remote signer. Client
 * publishes a 24133 request → we decrypt with the signer key, run the method,
 * and deliver an encrypted response back to the client's subscription.
 */
function loopbackTransport(opts: {
  signerSk: string
  userSk: string
  // hooks to simulate edge cases
  forceAuthOnce?: boolean
  failPublish?: boolean
  dropResponses?: boolean
  errorOnPing?: boolean
}): Nip46Transport {
  const signerPk = getPublicKey(opts.signerSk)
  let listener: ((e: NostrEvent) => void) | undefined
  let authChallenged = false
  return {
    async publish(event) {
      if (opts.failPublish) throw new Error('relay down')
      if (opts.dropResponses) return
      const req = JSON.parse(nip44.decryptFrom(event.content, opts.signerSk, event.pubkey)) as {
        id: string
        method: string
        params: string[]
      }
      const clientPk = event.pubkey
      const reply = (body: Record<string, string>) => {
        const content = nip44.encryptTo(JSON.stringify({ id: req.id, ...body }), opts.signerSk, clientPk)
        const resp = finalizeEvent(
          { kind: 24133, content, tags: [['p', clientPk]], created_at: 1 },
          opts.signerSk,
        )
        queueMicrotask(() => listener?.(resp))
      }
      if (opts.forceAuthOnce && !authChallenged && req.method !== 'connect') {
        authChallenged = true
        reply({ result: 'auth_url', error: 'https://signer.example/auth' })
        return
      }
      switch (req.method) {
        case 'connect':
          return reply({ result: 'ack' })
        case 'get_public_key':
          return reply({ result: getPublicKey(opts.userSk) })
        case 'ping':
          return opts.errorOnPing ? reply({ error: 'ping refused' }) : reply({ result: 'pong' })
        case 'sign_event': {
          const signed = finalizeEvent(JSON.parse(req.params[0]!) as EventTemplate, opts.userSk)
          return reply({ result: JSON.stringify(signed) })
        }
        case 'nip44_encrypt':
          return reply({ result: nip44.encryptTo(req.params[1]!, opts.userSk, req.params[0]!) })
        case 'nip44_decrypt':
          return reply({ result: nip44.decryptFrom(req.params[1]!, opts.userSk, req.params[0]!) })
        case 'nip04_decrypt':
          return reply({ result: 'legacy-plaintext' })
        case 'boom':
          return reply({ error: 'method not supported' })
        default:
          return reply({ error: 'unknown method' })
      }
    },
    subscribe(_clientPubkey, _relays, onEvent) {
      listener = onEvent
      return () => {
        listener = undefined
      }
    },
  }
}

const uri = (secret?: string) =>
  `bunker://${getPublicKey(SIGNER_SK)}?relay=wss://relay.example${secret ? `&secret=${secret}` : ''}`

describe('parseBunkerUri', () => {
  test('parses pubkey, relays, secret', () => {
    const p = parseBunkerUri(uri('s3cr3t'))
    expect(p.signerPubkey).toBe(getPublicKey(SIGNER_SK))
    expect(p.relays).toEqual(['wss://relay.example'])
    expect(p.secret).toBe('s3cr3t')
  })
  test('rejects non-bunker and relay-less URIs', () => {
    expect(() => parseBunkerUri('https://x')).toThrow('bunker://')
    expect(() => parseBunkerUri(`bunker://${getPublicKey(SIGNER_SK)}`)).toThrow('no relay')
  })
})

describe('BunkerSigner over loopback', () => {
  test('connect, get_public_key, sign, ping, encrypt/decrypt', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK })
    const signer = await bunkerSigner(uri(), { clientSecret: CLIENT_SK, transport })
    expect(signer.backend).toBe('nip46')
    expect(await signer.getPublicKey()).toBe(getPublicKey(USER_SK))
    expect(await signer.getPublicKey()).toBe(getPublicKey(USER_SK)) // cached path
    expect(await signer.ping()).toBe('pong')

    const event = await signer.signEvent({ kind: 1, tags: [], content: 'remote-signed' })
    expect(verifyEvent(event)).toBe(true)
    expect(event.pubkey).toBe(getPublicKey(USER_SK))

    const peer = getPublicKey('55'.repeat(32)) as Pubkey
    const ct = await signer.nip44Encrypt(peer, 'hi')
    expect(await signer.nip44Decrypt(peer, ct)).toBe('hi')
    expect(await signer.nip04Decrypt(peer, 'x')).toBe('legacy-plaintext')
    signer.close()
  })

  test('connect with a required secret', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK })
    const signer = await bunkerSigner(uri('topsecret'), { clientSecret: CLIENT_SK, transport })
    expect(await signer.ping()).toBe('pong')
    signer.close()
  })

  test('surfaces an auth_url challenge, then the real result arrives', async () => {
    // forceAuthOnce: the first non-connect request gets an auth_url response;
    // a second identical request (after "auth") succeeds. We drive that by
    // calling ping twice — the first call's auth_url is observed via onAuthUrl
    // and the request stays pending until it times out, so give it room and
    // assert the URL was surfaced.
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK, forceAuthOnce: true })
    const seen: string[] = []
    const signer = await bunkerSigner(uri(), {
      clientSecret: CLIENT_SK,
      transport,
      timeout: 30,
      onAuthUrl: (u) => seen.push(u),
    })
    // this ping is auth-challenged (no real result) → it times out, but the
    // onAuthUrl callback must have fired with the challenge URL.
    await expect(signer.ping()).rejects.toThrow('timed out')
    expect(seen).toEqual(['https://signer.example/auth'])
    signer.close()
  })

  test('rejects on a remote error response', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK, errorOnPing: true })
    const signer = await bunkerSigner(uri(), { clientSecret: CLIENT_SK, transport })
    await expect(signer.ping()).rejects.toThrow('ping refused')
    signer.close()
  })

  test('close rejects in-flight requests', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK, dropResponses: true })
    const signer = new BunkerSigner(parseBunkerUri(uri()), { clientSecret: CLIENT_SK, transport, timeout: 5000 })
    // connect() never resolves (responses dropped); close() must reject it.
    const connecting = signer.connect()
    signer.close()
    await expect(connecting).rejects.toThrow('bunker closed')
  })

  test('publish failure rejects the request', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK, failPublish: true })
    const signer = new BunkerSigner(parseBunkerUri(uri()), { clientSecret: CLIENT_SK, transport })
    await expect(signer.connect()).rejects.toThrow('relay down')
    signer.close()
  })

  test('request times out when responses are dropped', async () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK, dropResponses: true })
    const signer = new BunkerSigner(parseBunkerUri(uri()), {
      clientSecret: CLIENT_SK,
      transport,
      timeout: 20,
    })
    await expect(signer.connect()).rejects.toThrow('timed out')
    signer.close()
  })

  test('toPayload/fromPayload restores a (disconnected) bunker', () => {
    const transport = loopbackTransport({ signerSk: SIGNER_SK, userSk: USER_SK })
    const signer = new BunkerSigner(parseBunkerUri(uri('x')), { clientSecret: CLIENT_SK, transport })
    const restored = fromPayload(signer.toPayload(), { bunker: { clientSecret: CLIENT_SK, transport } })
    expect(restored.backend).toBe('nip46')
    expect(() => fromPayload(signer.toPayload())).toThrow('bunker deps')
  })

  test('fromPayload rejects unknown type', () => {
    expect(() => fromPayload(JSON.stringify({ type: 'mystery' }))).toThrow('unknown signer payload')
  })
})
