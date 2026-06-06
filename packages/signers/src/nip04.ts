// NIP-04 legacy DM decryption (AES-256-CBC). DECRYPT ONLY — we never emit NIP-04;
// modern messages use NIP-44 / NIP-17. Kept so old conversations stay readable.
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { cbc } from '@noble/ciphers/aes.js'
import { base64 } from '@scure/base'
import { bytesToUtf8, hexToBytes, toSecretBytes, type Pubkey } from '@hopstr/core'

/** Shared AES key = the X coordinate of the ECDH secret (NIP-04's quirk). */
function nip04Key(secret: Uint8Array | string, peer: string): Uint8Array {
  const shared = secp256k1.getSharedSecret(toSecretBytes(secret), hexToBytes('02' + peer))
  return shared.subarray(1, 33)
}

/** Decrypt a NIP-04 payload of the form `<base64-ct>?iv=<base64-iv>`. */
export function nip04Decrypt(secret: Uint8Array | string, peer: string | Pubkey, payload: string): string {
  const sep = payload.indexOf('?iv=')
  if (sep === -1) throw new Error('invalid NIP-04 payload: missing ?iv=')
  const ciphertext = base64.decode(payload.slice(0, sep))
  const iv = base64.decode(payload.slice(sep + 4))
  const plaintext = cbc(nip04Key(secret, peer), iv).decrypt(ciphertext)
  return bytesToUtf8(plaintext)
}
