import { loadIdentity, type Identity } from '@hopstr/core'
import { readConfig, CONFIG_PATH } from './config.ts'

export async function resolveIdentity(): Promise<Identity> {
  const nsecEnv = process.env['NOSTR_NSEC']
  if (nsecEnv) return loadIdentity(nsecEnv)

  const config = await readConfig()
  if (config.nsec) return loadIdentity(config.nsec)

  console.error('error: no identity found.')
  console.error('  set NOSTR_NSEC=nsec1... in your environment, or')
  console.error(`  add { "nsec": "nsec1..." } to ${CONFIG_PATH}`)
  process.exit(1)
}
