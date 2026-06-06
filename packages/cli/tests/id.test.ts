import { describe, test, expect, afterEach } from 'bun:test'
import { loadIdentity } from '@hopstr/core'
import { idNew, type IdNewDeps } from '../src/commands/id.ts'
import { CONFIG_PATH } from '../src/config.ts'

// An in-memory stand-in for the config file, so --save tests never touch
// the real ~/.config/hopstr/config.json.
function fakeConfig(initial: { nsec?: string; relays?: string[] } = {}): IdNewDeps & {
  saved: () => { nsec?: string; relays?: string[] } | undefined
} {
  let store: { nsec?: string; relays?: string[] } | undefined = { ...initial }
  let written: { nsec?: string; relays?: string[] } | undefined
  return {
    read: async () => ({ ...(store ?? {}) }),
    write: async (config) => { written = { ...config }; store = { ...config } },
    saved: () => written,
  }
}

describe('id new', () => {
  const origWrite = process.stdout.write.bind(process.stdout)
  const origLog = console.log

  afterEach(() => {
    process.stdout.write = origWrite
    console.log = origLog
  })

  function captureJson(): { get: () => string } {
    let captured = ''
    process.stdout.write = (s: string) => {
      captured += s
      return true
    }
    return { get: () => captured }
  }

  test('--json emits a valid { nsec, npub } pair', async () => {
    const cap = captureJson()
    await idNew({ json: true })
    process.stdout.write = origWrite

    const parsed = JSON.parse(cap.get().trim()) as { nsec: string; npub: string; saved?: string }
    expect(Object.keys(parsed).sort()).toEqual(['npub', 'nsec'])
    expect(parsed.nsec.startsWith('nsec1')).toBe(true)
    expect(parsed.npub.startsWith('npub1')).toBe(true)
    expect(cap.get().endsWith('\n')).toBe(true)
    // the nsec round-trips and yields the same npub → it's a real, consistent keypair
    expect(loadIdentity(parsed.nsec).npub).toBe(parsed.npub)
  })

  test('mints a different identity each call', async () => {
    const grab = async (): Promise<string> => {
      const cap = captureJson()
      await idNew({ json: true })
      process.stdout.write = origWrite
      return (JSON.parse(cap.get().trim()) as { nsec: string }).nsec
    }
    expect(await grab()).not.toBe(await grab())
  })

  test('human output prints both keys and an export hint', async () => {
    const lines: string[] = []
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    await idNew({ json: false })
    console.log = origLog

    const out = lines.join('\n')
    expect(out).toContain('nsec: nsec1')
    expect(out).toContain('npub: npub1')
    expect(out).toContain('export NOSTR_NSEC=nsec1')
  })

  test('--save writes the new nsec to the config', async () => {
    const cfg = fakeConfig()
    const cap = captureJson()
    await idNew({ json: true, save: true }, cfg)
    process.stdout.write = origWrite

    const parsed = JSON.parse(cap.get().trim()) as { nsec: string; npub: string; saved?: string }
    // the saved nsec matches what was minted, and it's a valid key
    expect(cfg.saved()?.nsec).toBe(parsed.nsec)
    expect(loadIdentity(cfg.saved()!.nsec!).npub).toBe(parsed.npub)
    // --json reports where it was saved
    expect(parsed.saved).toBe(CONFIG_PATH)
  })

  test('--save merges, preserving existing relays', async () => {
    const cfg = fakeConfig({ relays: ['wss://relay.example.com'] })
    await idNew({ json: true, save: true }, cfg)
    process.stdout.write = origWrite

    expect(cfg.saved()?.relays).toEqual(['wss://relay.example.com'])
    expect(cfg.saved()?.nsec?.startsWith('nsec1')).toBe(true)
  })

  test('--save human output mentions the config path', async () => {
    const lines: string[] = []
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    await idNew({ json: false, save: true }, fakeConfig())
    console.log = origLog

    expect(lines.join('\n')).toContain(`saved to ${CONFIG_PATH}`)
  })

  test('--save refuses to overwrite an existing nsec (exits 1, leaves config untouched)', async () => {
    const cfg = fakeConfig({ nsec: 'nsec1existing', relays: ['wss://keep.example.com'] })
    const origExit = process.exit.bind(process)
    let exitCode: number | undefined
    ;(process as { exit: (code?: number) => never }).exit = (code?: number) => {
      exitCode = code
      throw new Error('process.exit called')
    }
    const origErr = console.error
    console.error = () => {}
    try {
      await idNew({ json: true, save: true }, cfg)
    } catch {
      // expected — our mocked exit throws
    } finally {
      ;(process as { exit: (code?: number) => never }).exit = origExit
      console.error = origErr
      process.stdout.write = origWrite
    }
    expect(exitCode).toBe(1)
    expect(cfg.saved()).toBeUndefined() // never wrote
  })
})
