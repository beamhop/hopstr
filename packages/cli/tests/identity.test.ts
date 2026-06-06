import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolveIdentity } from '../src/identity.ts'

// A known test nsec/npub pair (not a real key — generated for tests)
const TEST_NSEC = 'nsec1nm82uz3f469y0cnwru4zmekcugnjmrvr7yuw6fsqn0skyf9lalssufrnam'

describe('resolveIdentity', () => {
  const origEnv = process.env['NOSTR_NSEC']

  afterEach(() => {
    if (origEnv === undefined) delete process.env['NOSTR_NSEC']
    else process.env['NOSTR_NSEC'] = origEnv
  })

  test('loads identity from NOSTR_NSEC env var', async () => {
    process.env['NOSTR_NSEC'] = TEST_NSEC
    const id = await resolveIdentity()
    expect(id.nsec).toBe(TEST_NSEC)
    expect(id.pubkey).toHaveLength(64)
    expect(id.npub.startsWith('npub1')).toBe(true)
  })

  test('exits with error when no identity is available', async () => {
    delete process.env['NOSTR_NSEC']
    // Mock config to return empty (no nsec in config file)
    // resolveIdentity calls process.exit(1) — capture it
    const origExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as { exit: (code?: number) => never }).exit = (code?: number) => {
      exitCode = code
      throw new Error('process.exit called')
    }
    try {
      await resolveIdentity()
    } catch {
      // expected
    } finally {
      ;(process as { exit: (code?: number) => never }).exit = origExit
    }
    expect(exitCode).toBe(1)
  })
})
