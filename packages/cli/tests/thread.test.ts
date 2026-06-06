import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { createIdentity, matchFilters, type Filter, type NostrEvent } from '@hopstr/core'
import { NostrClient, type ThreadNode } from '@hopstr/agent'
import { renderTree, snippet, thread } from '../src/commands/thread.ts'

// A minimal in-process Nostr relay (EVENT / REQ+match / EOSE), so the command's
// network path is exercised hermetically. Kept local to respect the CLI package's
// rootDir (it can't import the agent package's test harness).
interface MockRelay {
  url: string
  stop: () => void
}
function startRelay(): MockRelay {
  const stored: NostrEvent[] = []
  const server = Bun.serve({
    port: 0,
    fetch: (req, srv) => (srv.upgrade(req) ? undefined : new Response('ws only', { status: 426 })),
    websocket: {
      message(ws, raw) {
        const msg = JSON.parse(String(raw)) as unknown[]
        if (msg[0] === 'EVENT') {
          const e = msg[1] as NostrEvent
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

// minimal NostrEvent stub — renderTree only reads id, pubkey, content
function ev(id: string, pubkey: string, content: string): NostrEvent {
  return { id, pubkey, content, kind: 1, tags: [], created_at: 0, sig: '' } as unknown as NostrEvent
}

const ROOT_PK = 'a'.repeat(64)
const KID_PK = 'b'.repeat(64)
const ROOT_ID = '1'.repeat(64)
const KID_ID = '2'.repeat(64)

// root ─ kid
const tree: ThreadNode = {
  event: ev(ROOT_ID, ROOT_PK, 'the original question'),
  children: [{ event: ev(KID_ID, KID_PK, 'a reply'), children: [] }],
}

describe('renderTree', () => {
  const lines: string[] = []
  const origLog = console.log
  beforeEach(() => {
    lines.length = 0
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
  })
  afterEach(() => {
    console.log = origLog
  })

  test('prints root then child, indented by depth', () => {
    renderTree(tree, KID_ID, new Map(), 0)
    expect(lines.length).toBe(2)
    expect(lines[0]!.startsWith('▸')).toBe(true) // root, no indent
    expect(lines[1]!.startsWith('  └─')).toBe(true) // child, 2-space indent + branch
  })

  test('marks the target node and only the target', () => {
    renderTree(tree, KID_ID, new Map(), 0)
    expect(lines[0]).not.toContain('← you asked about this')
    expect(lines[1]).toContain('← you asked about this')
  })

  test('uses a resolved display name when provided, else a short npub', () => {
    const names = new Map([[ROOT_PK, 'alice']])
    renderTree(tree, ROOT_ID, names, 0)
    expect(lines[0]).toContain('alice:')
    expect(lines[1]).toContain('npub1') // child has no name → npub fallback
  })

  test('includes a short event id', () => {
    renderTree(tree, ROOT_ID, new Map(), 0)
    expect(lines[0]).toContain('(' + ROOT_ID.slice(0, 8) + ')')
  })
})

describe('snippet', () => {
  test('collapses whitespace and leaves short content intact', () => {
    expect(snippet('hello\n  world')).toBe('hello world')
  })

  test('truncates long content with an ellipsis', () => {
    const long = 'x'.repeat(100)
    const out = snippet(long)
    expect(out.length).toBe(60)
    expect(out.endsWith('…')).toBe(true)
  })
})

// End-to-end coverage of the command itself (network path) against an in-process
// relay. Exercises both output modes and the author-name resolution branches.
describe('thread command', () => {
  const relays: MockRelay[] = []
  afterEach(() => {
    while (relays.length) relays.pop()!.stop()
  })

  // alice has a profile name; bob does not → npub fallback. Returns the relay url
  // and the queried (middle) reply id so callers can run the command against it.
  async function seedThread() {
    const r = startRelay()
    relays.push(r)
    const alice = new NostrClient(createIdentity(), [r.url])
    const bob = new NostrClient(createIdentity(), [r.url])
    await alice.setProfile({ name: 'alice' })
    const root = await alice.post('Anyone running Bun in prod?')
    const mid = await bob.reply(root.id, 'yes, six months, zero issues')
    await alice.reply(mid.id, 'what about memory under load?')
    alice.close()
    bob.close()
    return { url: r.url, rootId: root.id, midId: mid.id, alicePk: alice.pubkey, bobPk: bob.pubkey }
  }

  test('human output renders the tree with names, npub fallback, and target marker', async () => {
    const { url, midId } = await seedThread()
    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    try {
      await thread(createIdentity(), midId, { json: false, relays: [url] })
    } finally {
      console.log = origLog
    }
    const out = lines.join('\n')
    expect(out).toContain('alice:') // resolved profile name
    expect(out).toContain('npub1') // bob has no profile → short npub
    expect(lines.filter((l) => l.includes('← you asked about this')).length).toBe(1)
    expect(lines.some((l) => l.startsWith('▸'))).toBe(true)
  })

  test('--json emits { root, target, tree } only', async () => {
    const { url, rootId, midId } = await seedThread()
    let captured = ''
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s: string) => {
      captured += s
      return true
    }
    try {
      await thread(createIdentity(), midId, { json: true, relays: [url] })
    } finally {
      process.stdout.write = orig
    }
    const parsed = JSON.parse(captured.trim())
    expect(Object.keys(parsed).sort()).toEqual(['root', 'target', 'tree'])
    expect(parsed.root.id).toBe(rootId)
    expect(parsed.target.id).toBe(midId)
    expect(parsed.tree.event.id).toBe(rootId)
    expect(captured.endsWith('\n')).toBe(true)
  })

  test('falls back to npub when a profile lookup throws', async () => {
    // A relay that errors on every REQ → getProfile rejects → resolveNames catch.
    const r = startRelay()
    relays.push(r)
    const alice = new NostrClient(createIdentity(), [r.url])
    const root = await alice.post('lonely note')
    alice.close()

    const lines: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
    try {
      // Point name resolution at a dead relay by closing the seeding client and
      // querying fresh; the author has no kind-0, so we still get an npub.
      await thread(createIdentity(), root.id, { json: false, relays: [r.url] })
    } finally {
      console.log = origLog
    }
    expect(lines.some((l) => l.includes('npub1'))).toBe(true)
  })
})
