// NIP-49: password-encrypted private keys at rest (ncryptsec).
// scrypt(password) → XChaCha20-Poly1305(secret), bech32 'ncryptsec'.
import { scrypt } from '@noble/hashes/scrypt.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bech32 } from '@scure/base'
import { bytesToHex, concatBytes, randomBytes, toSecretBytes, utf8ToBytes } from '@hopstr/core'

const VERSION = 0x02
const LIMIT = 5000

export type KeySecurity = 0x00 | 0x01 | 0x02

function deriveKey(password: string, salt: Uint8Array, logN: number): Uint8Array {
  // NFKC-normalize the password (NIP-49), then scrypt with N=2^logN, r=8, p=1.
  const normalized = utf8ToBytes(password.normalize('NFKC'))
  return scrypt(normalized, salt, { N: 2 ** logN, r: 8, p: 1, dkLen: 32 })
}

/** Encrypt a secret key into an `ncryptsec1...` string. */
export function encryptKey(
  secret: Uint8Array | string,
  password: string,
  logN = 16,
  keySecurity: KeySecurity = 0x02,
): string {
  const sk = toSecretBytes(secret)
  const salt = randomBytes(16)
  const nonce = randomBytes(24)
  const ad = new Uint8Array([keySecurity])
  const key = deriveKey(password, salt, logN)
  const ciphertext = xchacha20poly1305(key, nonce, ad).encrypt(sk) // 32 + 16 tag = 48
  const payload = concatBytes(new Uint8Array([VERSION, logN]), salt, nonce, ad, ciphertext)
  return bech32.encode('ncryptsec', bech32.toWords(payload), LIMIT)
}

/** Decrypt an `ncryptsec1...` string back to the 32-byte secret key. */
export function decryptKey(ncryptsec: string, password: string): Uint8Array {
  const { prefix, words } = bech32.decode(ncryptsec as `${string}1${string}`, LIMIT)
  if (prefix !== 'ncryptsec') throw new Error(`expected ncryptsec, got ${prefix}`)
  const data = bech32.fromWords(words)
  if (data.length !== 91) throw new Error('invalid ncryptsec length')
  const version = data[0]
  if (version !== VERSION) throw new Error(`unknown ncryptsec version ${version}`)
  const logN = data[1]!
  const salt = data.subarray(2, 18)
  const nonce = data.subarray(18, 42)
  const ad = data.subarray(42, 43)
  const ciphertext = data.subarray(43)
  const key = deriveKey(password, salt, logN)
  try {
    return xchacha20poly1305(key, nonce, ad).decrypt(ciphertext)
  } catch {
    throw new Error('wrong password or corrupt ncryptsec')
  }
}

/** Decrypt to a hex string. */
export function decryptKeyHex(ncryptsec: string, password: string): string {
  return bytesToHex(decryptKey(ncryptsec, password))
}
