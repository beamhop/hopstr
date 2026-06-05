// NIP-06: derive a Nostr key from a BIP-39 mnemonic via BIP-32 (m/44'/1237'/account'/0/0).
import { HDKey } from '@scure/bip32'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { bytesToHex } from '@nostragent/core'

/** Coin type 1237 is Nostr's registered SLIP-44 value. */
const path = (account: number): string => `m/44'/1237'/${account}'/0/0`

/** A fresh 12-word mnemonic (128 bits). */
export function generateSeedWords(): string {
  return generateMnemonic(wordlist, 128)
}

/** Is this a valid BIP-39 English mnemonic? */
export function validateWords(mnemonic: string): boolean {
  return validateMnemonic(mnemonic, wordlist)
}

/** Derive the 32-byte secret key for `account` (default 0) from a mnemonic. */
export function privateKeyFromSeedWords(mnemonic: string, account = 0, passphrase = ''): Uint8Array {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('invalid mnemonic')
  const seed = mnemonicToSeedSync(mnemonic, passphrase)
  const sk = HDKey.fromMasterSeed(seed).derive(path(account)).privateKey
  if (!sk) throw new Error('could not derive private key')
  return sk
}

/** Same, as a hex string. */
export function privateKeyHexFromSeedWords(mnemonic: string, account = 0, passphrase = ''): string {
  return bytesToHex(privateKeyFromSeedWords(mnemonic, account, passphrase))
}
