import { createIdentity } from '@hopstr/core'

/**
 * `hopstr id new` — mint a fresh Nostr identity (keypair). The nsec is the whole
 * identity and is printed once; save it (e.g. as NOSTR_NSEC or in the config file).
 * Needs no existing identity — it's how you get one.
 */
export function idNew(opts: { json: boolean }): void {
  const id = createIdentity()
  if (opts.json) {
    process.stdout.write(JSON.stringify({ nsec: id.nsec, npub: id.npub }) + '\n')
    return
  }
  console.log(`nsec: ${id.nsec}   (secret — save it, never share)`)
  console.log(`npub: ${id.npub}   (your public handle)`)
  console.log('')
  console.log('To use it:  export NOSTR_NSEC=' + id.nsec)
}
