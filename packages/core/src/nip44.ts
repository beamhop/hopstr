// NIP-44 v2 encryption: ECDH → HKDF → ChaCha20 + HMAC-SHA256, versioned padding.
// Implemented to the letter of the spec and verified against the official vectors.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { chacha20 } from '@noble/ciphers/chacha.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { extract as hkdfExtract, expand as hkdfExpand } from '@noble/hashes/hkdf.js'
import { base64 } from '@scure/base'
import {
  bytesToUtf8,
  concatBytes,
  hexToBytes,
  randomBytes,
  toSecretBytes,
  utf8ToBytes,
} from './primitives.ts'
import type { Pubkey } from './primitives.ts'

const SALT = /* @__PURE__ */ utf8ToBytes('nip44-v2')
const MIN_PLAINTEXT = 1
const MAX_PLAINTEXT = 65535

/**
 * Conversation key = HKDF-extract(SHA256, IKM = ECDH shared x-coordinate,
 * salt = "nip44-v2"). Symmetric in the two parties' keys, so cache it per peer.
 */
export function getConversationKey(secret: Uint8Array | string, peerPubkey: string | Pubkey): Uint8Array {
  const sk = toSecretBytes(secret)
  // 0x02 prefix → compressed point on the even-Y curve for the x-only peer key.
  // noble v2 requires bytes (not a hex string) for the peer point.
  const shared = secp256k1.getSharedSecret(sk, hexToBytes('02' + peerPubkey))
  const sharedX = shared.subarray(1, 33) // drop the format byte, keep 32-byte x
  return hkdfExtract(sha256, sharedX, SALT)
}

interface MessageKeys {
  chacha_key: Uint8Array
  chacha_nonce: Uint8Array
  hmac_key: Uint8Array
}

/** Per-message keys via HKDF-expand(conversation_key, info = nonce, L = 76). */
export function getMessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): MessageKeys {
  if (conversationKey.length !== 32) throw new Error('invalid conversation key length')
  if (nonce.length !== 32) throw new Error('invalid nonce length')
  const keys = hkdfExpand(sha256, conversationKey, nonce, 76)
  return {
    chacha_key: keys.subarray(0, 32),
    chacha_nonce: keys.subarray(32, 44),
    hmac_key: keys.subarray(44, 76),
  }
}

/** NIP-44 padding: pad to a power-of-two-ish chunk boundary, min 32 bytes. */
export function calcPaddedLen(len: number): number {
  if (!Number.isInteger(len) || len < 1) throw new Error('expected positive integer')
  if (len <= 32) return 32
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1)
  const chunk = nextPower <= 256 ? 32 : nextPower / 8
  return chunk * (Math.floor((len - 1) / chunk) + 1)
}

function pad(plaintext: string): Uint8Array {
  const unpadded = utf8ToBytes(plaintext)
  const len = unpadded.length
  if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT) throw new Error('invalid plaintext length')
  const prefix = new Uint8Array(2)
  new DataView(prefix.buffer).setUint16(0, len, false) // big-endian length
  const suffix = new Uint8Array(calcPaddedLen(len) - len)
  return concatBytes(prefix, unpadded, suffix)
}

function unpad(padded: Uint8Array): string {
  const unpaddedLen = (padded[0]! << 8) | padded[1]!
  const unpadded = padded.subarray(2, 2 + unpaddedLen)
  if (
    unpaddedLen < MIN_PLAINTEXT ||
    unpaddedLen > MAX_PLAINTEXT ||
    unpadded.length !== unpaddedLen ||
    padded.length !== 2 + calcPaddedLen(unpaddedLen)
  ) {
    throw new Error('invalid padding')
  }
  return bytesToUtf8(unpadded)
}

function hmacAad(key: Uint8Array, message: Uint8Array, aad: Uint8Array): Uint8Array {
  if (aad.length !== 32) throw new Error('AAD associated data must be 32 bytes')
  return hmac(sha256, key, concatBytes(aad, message))
}

/**
 * Encrypt `plaintext` for `peerPubkey`. `nonce` is for testing only — leave it
 * undefined in real use so a fresh random 32-byte nonce is generated.
 */
export function encrypt(
  plaintext: string,
  conversationKey: Uint8Array,
  nonce: Uint8Array = randomBytes(32),
): string {
  const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce)
  const padded = pad(plaintext)
  const ciphertext = chacha20(chacha_key, chacha_nonce, padded)
  const mac = hmacAad(hmac_key, ciphertext, nonce)
  return base64.encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac))
}

/** Decrypt a NIP-44 v2 payload. Throws on any malformation or MAC mismatch. */
export function decrypt(payload: string, conversationKey: Uint8Array): string {
  if (payload.length < 132 || payload.length > 87472) throw new Error('invalid payload size')
  if (payload[0] === '#') throw new Error('unknown encryption version')
  let data: Uint8Array
  try {
    data = base64.decode(payload)
  } catch {
    throw new Error('invalid base64')
  }
  const version = data[0]
  if (version !== 2) throw new Error(`unknown encryption version ${version}`)
  if (data.length < 99 || data.length > 65603) throw new Error('invalid payload size')
  const nonce = data.subarray(1, 33)
  const ciphertext = data.subarray(33, data.length - 32)
  const mac = data.subarray(data.length - 32)
  const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce)
  const expectedMac = hmacAad(hmac_key, ciphertext, nonce)
  if (!constantTimeEqual(mac, expectedMac)) throw new Error('invalid MAC')
  const padded = chacha20(chacha_key, chacha_nonce, ciphertext)
  return unpad(padded)
}

/** High-level: encrypt with raw keys, deriving the conversation key for you. */
export function encryptTo(
  plaintext: string,
  secret: Uint8Array | string,
  peerPubkey: string | Pubkey,
  nonce?: Uint8Array,
): string {
  return encrypt(plaintext, getConversationKey(secret, peerPubkey), nonce)
}

/** High-level: decrypt with raw keys, deriving the conversation key for you. */
export function decryptFrom(
  payload: string,
  secret: Uint8Array | string,
  peerPubkey: string | Pubkey,
): string {
  return decrypt(payload, getConversationKey(secret, peerPubkey))
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

export { hexToBytes }
