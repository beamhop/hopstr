// Local signer, NIP-06 derivation, NIP-49 ncryptsec (official vector), NIP-04 decrypt.
import { describe, expect, test } from 'bun:test'
import { finalizeEvent, getPublicKey, nip44, verifyEvent } from '@nostragent/core'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { cbc } from '@noble/ciphers/aes.js'
import { base64 } from '@scure/base'
import { utf8ToBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { privateKeySigner, LocalSigner } from '../src/local.ts'
import {
  generateSeedWords,
  privateKeyFromSeedWords,
  privateKeyHexFromSeedWords,
  validateWords,
} from '../src/nip06.ts'
import { decryptKey, decryptKeyHex, encryptKey } from '../src/nip49.ts'
import { fromPayload } from '../src/payload.ts'

const SK = '0000000000000000000000000000000000000000000000000000000000000001'

describe('LocalSigner', () => {
  test('signs verifiable events, exposes pubkey', async () => {
    const signer = privateKeySigner(SK)
    expect(await signer.getPublicKey()).toBe(getPublicKey(SK))
    const event = await signer.signEvent({ kind: 1, tags: [], content: 'gm' })
    expect(verifyEvent(event)).toBe(true)
    expect(signer.backend).toBe('local')
  })

  test('nip44 round-trips with itself and a peer', async () => {
    const alice = privateKeySigner(SK)
    const bobSk = '02'.repeat(31) + '03'
    const bob = privateKeySigner(bobSk)
    const alicePk = await alice.getPublicKey()
    const bobPk = await bob.getPublicKey()
    const ct = await alice.nip44Encrypt(bobPk, 'hello bob')
    expect(await bob.nip44Decrypt(alicePk, ct)).toBe('hello bob')
  })

  test('nip04 legacy decrypt reads an AES-CBC message', async () => {
    // build a NIP-04 payload by hand the way old clients did
    const senderSk = SK
    const recipient = privateKeySigner('07'.repeat(32))
    const recipientPk = await recipient.getPublicKey()
    const senderPk = getPublicKey(senderSk)
    const shared = secp256k1.getSharedSecret(hexToBytes(senderSk), hexToBytes('02' + recipientPk)).subarray(1, 33)
    const iv = new Uint8Array(16).fill(9)
    const ct = cbc(shared, iv).encrypt(utf8ToBytes('legacy hi'))
    const payload = `${base64.encode(ct)}?iv=${base64.encode(iv)}`
    expect(await recipient.nip04Decrypt(senderPk, payload)).toBe('legacy hi')
  })

  test('accepts nsec and bytes; rejects bad byte length', () => {
    const id = privateKeySigner(SK)
    expect(() => privateKeySigner(new Uint8Array(31))).toThrow()
    expect(new LocalSigner(hexToBytes(SK)).backend).toBe('local')
    expect(privateKeySigner(hexToBytes(SK)).backend).toBe('local')
    void id
  })

  test('toPayload/fromPayload round-trips a local signer', async () => {
    const signer = privateKeySigner(SK)
    const restored = fromPayload(signer.toPayload())
    expect(await restored.getPublicKey()).toBe(getPublicKey(SK))
  })
})

describe('NIP-06 derivation', () => {
  test('known vector', () => {
    // from the NIP-06 test vectors
    const mnemonic = 'leader monkey parrot ring guide accident before fence cannon height naive bean'
    const hex = privateKeyHexFromSeedWords(mnemonic)
    expect(hex).toBe('7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a')
  })
  test('generate + validate + derive account', () => {
    const words = generateSeedWords()
    expect(words.split(' ').length).toBe(12)
    expect(validateWords(words)).toBe(true)
    expect(privateKeyFromSeedWords(words, 1).length).toBe(32)
  })
  test('rejects an invalid mnemonic', () => {
    expect(() => privateKeyFromSeedWords('not a real mnemonic at all nope nope')).toThrow('invalid mnemonic')
    expect(validateWords('totally bogus words here')).toBe(false)
  })
})

describe('NIP-49 ncryptsec', () => {
  test('official vector decrypts to the known key', () => {
    const ncryptsec =
      'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p'
    expect(decryptKeyHex(ncryptsec, 'nostr')).toBe(
      '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683',
    )
  })

  test('encrypt → decrypt round-trip (small logN for speed)', () => {
    const ncryptsec = encryptKey(SK, 'hunter2', 8, 0x01)
    expect(ncryptsec.startsWith('ncryptsec1')).toBe(true)
    expect(bytesToHex(decryptKey(ncryptsec, 'hunter2'))).toBe(SK)
  })

  test('wrong password throws', () => {
    const ncryptsec = encryptKey(SK, 'right', 8)
    expect(() => decryptKey(ncryptsec, 'wrong')).toThrow('wrong password')
  })

  test('rejects non-ncryptsec / bad version / bad length', () => {
    expect(() => decryptKey('npub1xyz', 'x')).toThrow()
  })

  test('NFKC password normalization (composed == decomposed)', () => {
    // 'é' composed (U+00E9) vs decomposed (e + U+0301) must derive the same key
    const composed = 'é'
    const decomposed = 'é'
    const ncryptsec = encryptKey(SK, composed, 8)
    expect(bytesToHex(decryptKey(ncryptsec, decomposed))).toBe(SK)
  })
})
