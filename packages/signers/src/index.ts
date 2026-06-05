// @nostragent/signers — one async Signer interface, every backend.
export type { Signer, SignerBackend, SignerPayload } from './signer.ts'

export { LocalSigner, privateKeySigner } from './local.ts'
export { Nip07Signer, nip07Signer, type Nip07Provider } from './nip07.ts'
export {
  BunkerSigner,
  bunkerSigner,
  parseBunkerUri,
  type Nip46Transport,
  type BunkerOptions,
} from './nip46.ts'

export { fromPayload, type FromPayloadDeps } from './payload.ts'

// NIP-06 mnemonic derivation
export {
  generateSeedWords,
  validateWords,
  privateKeyFromSeedWords,
  privateKeyHexFromSeedWords,
} from './nip06.ts'

// NIP-49 encrypted keys at rest
export { encryptKey, decryptKey, decryptKeyHex, type KeySecurity } from './nip49.ts'

// NIP-04 legacy decrypt (read-only)
export { nip04Decrypt } from './nip04.ts'
