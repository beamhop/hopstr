// NIP-44 v2 driven entirely by the official test vectors (paulmillr/nip44).
// The invalid.* groups are what push the error paths to full coverage.
import { describe, expect, test } from 'bun:test'
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import {
  calcPaddedLen,
  decrypt,
  decryptFrom,
  encrypt,
  encryptTo,
  getConversationKey,
  getMessageKeys,
} from '../src/nip44.ts'
import { getPublicKey } from '../src/serialize.ts'
import vectors from '../../../tests/fixtures/nip44.vectors.json' with { type: 'json' }

const v2 = vectors.v2

describe('valid.get_conversation_key', () => {
  for (const [i, t] of v2.valid.get_conversation_key.entries()) {
    test(`vector ${i}`, () => {
      expect(bytesToHex(getConversationKey(t.sec1, t.pub2))).toBe(t.conversation_key)
    })
  }
})

describe('valid.get_message_keys', () => {
  const ck = hexToBytes(v2.valid.get_message_keys.conversation_key)
  for (const [i, k] of v2.valid.get_message_keys.keys.entries()) {
    test(`vector ${i}`, () => {
      const m = getMessageKeys(ck, hexToBytes(k.nonce))
      expect(bytesToHex(m.chacha_key)).toBe(k.chacha_key)
      expect(bytesToHex(m.chacha_nonce)).toBe(k.chacha_nonce)
      expect(bytesToHex(m.hmac_key)).toBe(k.hmac_key)
    })
  }
})

describe('valid.calc_padded_len', () => {
  for (const pair of v2.valid.calc_padded_len as Array<[number, number]>) {
    const [unpadded, padded] = pair
    test(`${unpadded} → ${padded}`, () => {
      expect(calcPaddedLen(unpadded)).toBe(padded)
    })
  }
})

describe('valid.encrypt_decrypt', () => {
  for (const [i, t] of v2.valid.encrypt_decrypt.entries()) {
    test(`vector ${i}`, () => {
      const pub2 = getPublicKey(t.sec2)
      const ck = getConversationKey(t.sec1, pub2)
      expect(bytesToHex(ck)).toBe(t.conversation_key)
      // byte-exact payload with the vector's fixed nonce
      expect(encrypt(t.plaintext, ck, hexToBytes(t.nonce))).toBe(t.payload)
      // decrypt from the other side
      const pub1 = getPublicKey(t.sec1)
      const ck2 = getConversationKey(t.sec2, pub1)
      expect(decrypt(t.payload, ck2)).toBe(t.plaintext)
      // high-level helpers round-trip too
      expect(decryptFrom(encryptTo(t.plaintext, t.sec1, pub2), t.sec2, pub1)).toBe(t.plaintext)
    })
  }
})

describe('valid.encrypt_decrypt_long_msg', () => {
  for (const [i, t] of v2.valid.encrypt_decrypt_long_msg.entries()) {
    test(`vector ${i}`, () => {
      const plaintext = t.pattern.repeat(t.repeat)
      expect(bytesToHex(sha256(utf8ToBytes(plaintext)))).toBe(t.plaintext_sha256)
      const ck = hexToBytes(t.conversation_key)
      const payload = encrypt(plaintext, ck, hexToBytes(t.nonce))
      expect(bytesToHex(sha256(utf8ToBytes(payload)))).toBe(t.payload_sha256)
      expect(decrypt(payload, ck)).toBe(plaintext)
    })
  }
})

describe('invalid.encrypt_msg_lengths', () => {
  const ck = new Uint8Array(32).fill(1)
  for (const len of v2.invalid.encrypt_msg_lengths) {
    test(`length ${len} throws`, () => {
      expect(() => encrypt('a'.repeat(len), ck)).toThrow()
    })
  }
})

describe('invalid.get_conversation_key', () => {
  for (const [i, t] of v2.invalid.get_conversation_key.entries()) {
    test(`vector ${i} (${t.note ?? ''})`, () => {
      expect(() => getConversationKey(t.sec1, t.pub2)).toThrow()
    })
  }
})

describe('invalid.decrypt', () => {
  for (const [i, t] of v2.invalid.decrypt.entries()) {
    test(`vector ${i} (${t.note ?? ''})`, () => {
      expect(() => decrypt(t.payload, hexToBytes(t.conversation_key))).toThrow()
    })
  }
})

describe('extra error paths', () => {
  test('getMessageKeys rejects bad conversation key length', () => {
    expect(() => getMessageKeys(new Uint8Array(31), new Uint8Array(32))).toThrow()
  })
  test('getMessageKeys rejects bad nonce length', () => {
    expect(() => getMessageKeys(new Uint8Array(32), new Uint8Array(31))).toThrow()
  })
  test('calcPaddedLen rejects non-positive', () => {
    expect(() => calcPaddedLen(0)).toThrow()
    expect(() => calcPaddedLen(1.5)).toThrow()
  })
  test('decrypt rejects oversized/undersized payload string', () => {
    expect(() => decrypt('a'.repeat(10), new Uint8Array(32))).toThrow('invalid payload size')
    expect(() => decrypt('#' + 'a'.repeat(200), new Uint8Array(32))).toThrow('unknown encryption version')
  })
})
