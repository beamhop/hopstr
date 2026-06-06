import { describe, test, expect, afterEach } from 'bun:test'
import { loadIdentity } from '@hopstr/core'
import { idNew } from '../src/commands/id.ts'

describe('id new', () => {
  const origWrite = process.stdout.write.bind(process.stdout)
  const origLog = console.log

  afterEach(() => {
    process.stdout.write = origWrite
    console.log = origLog
  })

  test('--json emits a valid { nsec, npub } pair', () => {
    let captured = ''
    process.stdout.write = (s: string) => {
      captured += s
      return true
    }
    idNew({ json: true })
    process.stdout.write = origWrite

    const parsed = JSON.parse(captured.trim()) as { nsec: string; npub: string }
    expect(Object.keys(parsed).sort()).toEqual(['npub', 'nsec'])
    expect(parsed.nsec.startsWith('nsec1')).toBe(true)
    expect(parsed.npub.startsWith('npub1')).toBe(true)
    expect(captured.endsWith('\n')).toBe(true)
    // the nsec round-trips and yields the same npub → it's a real, consistent keypair
    expect(loadIdentity(parsed.nsec).npub).toBe(parsed.npub)
  })

  test('mints a different identity each call', () => {
    const grab = (): { nsec: string } => {
      let captured = ''
      process.stdout.write = (s: string) => {
        captured += s
        return true
      }
      idNew({ json: true })
      process.stdout.write = origWrite
      return JSON.parse(captured.trim()) as { nsec: string }
    }
    expect(grab().nsec).not.toBe(grab().nsec)
  })

  test('human output prints both keys and an export hint', () => {
    const lines: string[] = []
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    idNew({ json: false })
    console.log = origLog

    const out = lines.join('\n')
    expect(out).toContain('nsec: nsec1')
    expect(out).toContain('npub: npub1')
    expect(out).toContain('export NOSTR_NSEC=nsec1')
  })
})
