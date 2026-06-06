import { createIdentity } from '@hopstr/core'
import { readConfig, writeConfig, CONFIG_PATH } from '../config.ts'

// Config read/write are injectable so tests can exercise --save without touching
// the real ~/.config/hopstr/config.json; defaults are the real implementations.
export interface IdNewDeps {
  read: typeof readConfig
  write: typeof writeConfig
}

/**
 * `hopstr id new [--save] [--json]` — mint a fresh Nostr identity (keypair). The
 * nsec is the whole identity; with --save it's written to the config file, otherwise
 * it's only printed (set NOSTR_NSEC yourself). Needs no existing identity — it's how
 * you get one. Returns the new identity's npub.
 */
export async function idNew(
  opts: { json: boolean; save?: boolean },
  deps: IdNewDeps = { read: readConfig, write: writeConfig },
): Promise<void> {
  const id = createIdentity()

  if (opts.save) {
    const config = await deps.read()
    if (config.nsec) {
      console.error(`error: ${CONFIG_PATH} already has an nsec; refusing to overwrite it.`)
      console.error('  remove it first, or run without --save and set NOSTR_NSEC yourself.')
      process.exit(1)
    }
    await deps.write({ ...config, nsec: id.nsec }) // merge — keep any existing relays
  }

  if (opts.json) {
    const out: { nsec: string; npub: string; saved?: string } = { nsec: id.nsec, npub: id.npub }
    if (opts.save) out.saved = CONFIG_PATH
    process.stdout.write(JSON.stringify(out) + '\n')
    return
  }

  console.log(`nsec: ${id.nsec}   (secret — save it, never share)`)
  console.log(`npub: ${id.npub}   (your public handle)`)
  console.log('')
  if (opts.save) {
    console.log(`saved to ${CONFIG_PATH} — you're ready to use hopstr.`)
  } else {
    console.log('To use it:  export NOSTR_NSEC=' + id.nsec)
    console.log('   or save it to the config file with:  hopstr id new --save')
  }
}
