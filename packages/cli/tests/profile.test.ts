import { describe, test, expect, afterEach } from 'bun:test'
import { createIdentity, matchFilters, type Filter, type NostrEvent } from '@hopstr/core'
import { NostrClient } from '@hopstr/agent'
import {
  coerceValue,
  parseSetArgs,
  applyChanges,
  formatProfile,
  profileGet,
  profileSet,
} from '../src/commands/profile.ts'

// ── pure helpers (no network) ──

describe('coerceValue', () => {
  test('coerces bot to a boolean', () => {
    expect(coerceValue('bot', 'true')).toBe(true)
    expect(coerceValue('bot', 'TRUE')).toBe(true)
    expect(coerceValue('bot', 'false')).toBe(false)
    expect(coerceValue('bot', 'nonsense')).toBe(false)
  })
  test('leaves other fields as strings', () => {
    expect(coerceValue('name', 'Alice')).toBe('Alice')
    expect(coerceValue('lud16', 'a@b.com')).toBe('a@b.com')
  })
})

describe('parseSetArgs', () => {
  test('parses repeatable --key value pairs', () => {
    const { changes, replace } = parseSetArgs(['--name', 'Alice', '--about', 'hi'])
    expect(changes).toEqual({ name: 'Alice', about: 'hi' })
    expect(replace).toBe(false)
  })
  test('supports --key=value form', () => {
    expect(parseSetArgs(['--name=Alice', '--about=hi there']).changes).toEqual({
      name: 'Alice',
      about: 'hi there',
    })
  })
  test('coerces bot during parsing', () => {
    expect(parseSetArgs(['--bot', 'true']).changes).toEqual({ bot: true })
  })
  test('accepts arbitrary (non-well-known) fields as strings', () => {
    expect(parseSetArgs(['--pronouns', 'they/them']).changes).toEqual({ pronouns: 'they/them' })
  })
  test('detects --replace and excludes it from changes', () => {
    const { changes, replace } = parseSetArgs(['--name', 'Alice', '--replace'])
    expect(replace).toBe(true)
    expect(changes).toEqual({ name: 'Alice' })
  })
  test('a bare flag with no value becomes empty string (clears)', () => {
    expect(parseSetArgs(['--about']).changes).toEqual({ about: '' })
    expect(parseSetArgs(['--about', '--name', 'Alice']).changes).toEqual({ about: '', name: 'Alice' })
  })
  test('ignores leaked global flags and their values', () => {
    const { changes } = parseSetArgs(['--json', '--relay', 'wss://x', '--name', 'Alice'])
    expect(changes).toEqual({ name: 'Alice' })
  })
})

describe('applyChanges', () => {
  test('merge: changes win, old fields preserved', () => {
    expect(applyChanges({ name: 'Old', about: 'keep' }, { name: 'New' }, false)).toEqual({
      name: 'New',
      about: 'keep',
    })
  })
  test('merge: null current is treated as empty', () => {
    expect(applyChanges(null, { name: 'Alice' }, false)).toEqual({ name: 'Alice' })
  })
  test('empty-string value deletes the key (merge)', () => {
    expect(applyChanges({ name: 'Alice', about: 'gone' }, { about: '' }, false)).toEqual({
      name: 'Alice',
    })
  })
  test('replace: uses only changes, dropping everything else', () => {
    expect(applyChanges({ name: 'Old', about: 'wiped' }, { name: 'New' }, true)).toEqual({
      name: 'New',
    })
  })
  test('replace: empty-string values are omitted', () => {
    expect(applyChanges({ name: 'Old' }, { name: 'New', about: '' }, true)).toEqual({ name: 'New' })
  })
})

describe('formatProfile', () => {
  test('null → (no profile set)', () => {
    expect(formatProfile(null)).toEqual(['(no profile set)'])
  })
  test('renders known fields, skips empty/missing', () => {
    const out = formatProfile({ name: 'Alice', about: '', website: 'https://a.co' }).join('\n')
    expect(out).toContain('name')
    expect(out).toContain('Alice')
    expect(out).toContain('https://a.co')
    expect(out).not.toContain('about') // empty string skipped
  })
  test('renders bot boolean and extra non-well-known fields', () => {
    const out = formatProfile({ bot: true, pronouns: 'they/them' }).join('\n')
    expect(out).toContain('bot')
    expect(out).toContain('true')
    expect(out).toContain('pronouns')
    expect(out).toContain('they/them')
  })
  test('empty object → (empty profile)', () => {
    expect(formatProfile({})).toEqual(['(empty profile)'])
  })
})

// ── network path against an in-process relay (mirrors thread.test.ts) ──

interface MockRelay {
  url: string
  stop: () => void
}
// Keeps only the newest replaceable event per (kind, pubkey) for kind-0/3/1xxxx,
// so a `set` after a seed leaves exactly one kind-0 — deterministic newest-wins.
function startRelay(): MockRelay {
  const stored: NostrEvent[] = []
  const isReplaceable = (k: number): boolean => k === 0 || k === 3 || (k >= 10000 && k < 20000)
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('ws only', { status: 426 })),
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as unknown[]
        if (msg[0] === 'EVENT') {
          const e = msg[1] as NostrEvent
          if (isReplaceable(e.kind)) {
            const i = stored.findIndex((s) => s.kind === e.kind && s.pubkey === e.pubkey)
            if (i !== -1) stored.splice(i, 1)
          }
          stored.push(e)
          ws.send(JSON.stringify(['OK', e.id, true, '']))
        } else if (msg[0] === 'REQ') {
          const id = msg[1] as string
          const filters = msg.slice(2) as Filter[]
          for (const e of stored) if (matchFilters(filters, e)) ws.send(JSON.stringify(['EVENT', id, e]))
          ws.send(JSON.stringify(['EOSE', id]))
        }
      },
    },
  })
  return { url: `ws://localhost:${server.port}`, stop: () => server.stop(true) }
}

describe('profile command (network)', () => {
  const relays: MockRelay[] = []
  afterEach(() => {
    while (relays.length) relays.pop()!.stop()
  })

  function relay(): string {
    const r = startRelay()
    relays.push(r)
    return r.url
  }

  // seed a profile for a fresh identity against one relay
  async function seed(url: string, meta: Record<string, unknown>) {
    const id = createIdentity()
    const c = new NostrClient(id, [url])
    await c.setProfile(meta)
    c.close()
    return id
  }

  function captureStdout(): { get: () => string; restore: () => void } {
    let captured = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s: string) => {
      captured += s
      return true
    }
    return { get: () => captured, restore: () => { process.stdout.write = orig } }
  }

  test('get --json returns the seeded metadata for self', async () => {
    const url = relay()
    const id = await seed(url, { name: 'alice', about: 'hi' })

    const cap = captureStdout()
    try {
      await profileGet(id, undefined, { json: true, relays: [url] })
    } finally {
      cap.restore()
    }
    const parsed = JSON.parse(cap.get().trim())
    expect(parsed).toEqual({ name: 'alice', about: 'hi' })
    expect(cap.get().endsWith('\n')).toBe(true)
  })

  test('get (human) of an absent profile prints (no profile set)', async () => {
    const url = relay()
    const lines: string[] = []
    const origLog = console.log
    console.log = (...a: unknown[]) => lines.push(a.join(' '))
    try {
      await profileGet(createIdentity(), undefined, { json: false, relays: [url] })
    } finally {
      console.log = origLog
    }
    expect(lines).toContain('(no profile set)')
  })

  test('set merges: setting one field keeps the others', async () => {
    const url = relay()
    const id = await seed(url, { name: 'alice', about: 'original about' })

    await profileSet(id, ['--website', 'https://alice.dev'], { json: true, relays: [url] })

    const v = new NostrClient(id, [url])
    const after = await v.getProfile(id.npub)
    v.close()
    expect(after).toEqual({ name: 'alice', about: 'original about', website: 'https://alice.dev' })
  })

  test('set --replace overwrites the whole profile', async () => {
    const url = relay()
    const id = await seed(url, { name: 'alice', about: 'gone after replace' })

    await profileSet(id, ['--name', 'bob', '--replace'], { json: false, relays: [url] })

    const v = new NostrClient(id, [url])
    const after = await v.getProfile(id.npub)
    v.close()
    expect(after).toEqual({ name: 'bob' })
  })

  test('set --about "" deletes the field from the merged profile', async () => {
    const url = relay()
    const id = await seed(url, { name: 'alice', about: 'remove me' })

    await profileSet(id, ['--about', ''], { json: true, relays: [url] })

    const v = new NostrClient(id, [url])
    const after = await v.getProfile(id.npub)
    v.close()
    expect(after).toEqual({ name: 'alice' })
  })

  test('set --json emits the PublishOk', async () => {
    const url = relay()
    const cap = captureStdout()
    try {
      await profileSet(createIdentity(), ['--name', 'alice'], { json: true, relays: [url] })
    } finally {
      cap.restore()
    }
    const parsed = JSON.parse(cap.get().trim())
    expect(parsed.ok).toBe(true)
    expect(typeof parsed.id).toBe('string')
  })
})
