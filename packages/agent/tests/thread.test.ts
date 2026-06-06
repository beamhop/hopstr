// Thread reconstruction: NostrClient.thread() rebuilds a whole conversation from
// any node — a root, a mid-thread reply, or a NIP-22 comment.
import { afterEach, describe, expect, test } from 'bun:test'
import { createIdentity, finalizeEvent, nip19, type NostrEvent } from '@hopstr/core'
import { extra } from '@hopstr/nips'
import { NostrClient } from '../src/facade.ts'
import { startRelay, type MockRelay } from './relay-harness.ts'

const relays: MockRelay[] = []
function relay(seed: NostrEvent[] = []): MockRelay {
  const r = startRelay(seed)
  relays.push(r)
  return r
}
afterEach(() => {
  while (relays.length) relays.pop()!.stop()
})

// Build a thread on a fresh relay:
//   root ─ replyA ─ replyB (nested)
//        └ comment (NIP-22 kind-1111, tags root via E, parent via e)
async function buildThread() {
  const r = relay()
  const alice = new NostrClient(createIdentity(), [r.url])
  const root = await alice.post('Anyone running Bun in prod?')
  const replyA = await alice.reply(root.id, 'yes, six months, zero issues')
  const replyB = await alice.reply(replyA.id, 'what about memory under load?')
  const comment = await alice.publish(
    extra.comment(
      'a NIP-22 comment on the root',
      { id: root.id, kind: 1, pubkey: alice.pubkey },
    ),
  )
  return { r, alice, root, replyA, replyB, comment }
}

describe('thread', () => {
  test('from a mid-thread reply returns the whole tree, rooted at the root', async () => {
    const { alice, root, replyA, replyB, comment } = await buildThread()
    const t = await alice.thread(replyA.id)

    expect(String(t.root.id)).toBe(root.id)
    expect(String(t.tree.event.id)).toBe(root.id)
    expect(String(t.target.id)).toBe(replyA.id)
    const ids = new Set(t.events.map((e) => String(e.id)))
    expect(ids).toEqual(new Set([root.id, replyA.id, replyB.id, comment.id]))
    alice.close()
  })

  test('detects the root even from the deepest node', async () => {
    const { alice, root, replyB } = await buildThread()
    const t = await alice.thread(replyB.id)
    expect(String(t.root.id)).toBe(root.id)
    expect(String(t.target.id)).toBe(replyB.id)
    alice.close()
  })

  test('builds the parent→child structure with children oldest→newest', async () => {
    const { alice, root, replyA, replyB, comment } = await buildThread()
    const t = await alice.thread(root.id)

    // root's direct children: replyA and the NIP-22 comment (both tag the root)
    const topIds = t.tree.children.map((c) => String(c.event.id))
    expect(topIds).toContain(replyA.id)
    expect(topIds).toContain(comment.id)
    // sorted ascending by created_at
    const times = t.tree.children.map((c) => c.event.created_at)
    expect(times).toEqual([...times].sort((a, b) => a - b))
    // replyB is nested under replyA
    const aNode = t.tree.children.find((c) => c.event.id === replyA.id)!
    expect(aNode.children.map((c) => String(c.event.id))).toEqual([replyB.id])
    alice.close()
  })

  test('includes a NIP-22 comment and parents it correctly', async () => {
    const { alice, root, comment } = await buildThread()
    const t = await alice.thread(comment.id)
    expect(String(t.root.id)).toBe(root.id)
    const commentNode = t.tree.children.find((c) => c.event.id === comment.id)
    expect(commentNode).toBeTruthy()
    alice.close()
  })

  test('a lone note is a single-node thread (target === root)', async () => {
    const r = relay()
    const alice = new NostrClient(createIdentity(), [r.url])
    const root = await alice.post('just thinking out loud')
    const t = await alice.thread(root.id)
    expect(t.events.length).toBe(1)
    expect(String(t.target.id)).toBe(root.id)
    expect(String(t.root.id)).toBe(root.id)
    expect(t.tree.children).toEqual([])
    alice.close()
  })

  test('throws when the event is not found', async () => {
    const r = relay()
    const alice = new NostrClient(createIdentity(), [r.url])
    await expect(alice.thread('ab'.repeat(32))).rejects.toThrow('not found')
    alice.close()
  })

  test('accepts a note1… or nevent1… id', async () => {
    const { alice, root, replyA } = await buildThread()
    const fromNote = await alice.thread(nip19.encodeNote(replyA.id))
    expect(String(fromNote.root.id)).toBe(root.id)
    const fromNevent = await alice.thread(nip19.encodeNevent({ id: replyA.id }))
    expect(String(fromNevent.root.id)).toBe(root.id)
    alice.close()
  })

  test('climbs parent links when there is no root marker', async () => {
    // A reply that carries only a `reply` marker (no `root` marker): rootId() is
    // undefined, so thread() must climb via parentId() to reach the parent — which
    // is the real root. This exercises the parent-climb branch and its loop body.
    // We seed the relay with pre-built events so the child's e-tag matches the real
    // root id (publishing through the facade would re-sign and change ids).
    const sk = '02'.repeat(32)
    const root = finalizeEvent({ kind: 1, content: 'root', tags: [] }, sk)
    const child = finalizeEvent({ kind: 1, content: 'child', tags: [['e', root.id, '', 'reply']] }, sk)

    const r = relay([root, child])
    const alice = new NostrClient(createIdentity(), [r.url])

    const t = await alice.thread(child.id)
    expect(t.root.id).toBe(root.id)
    expect(new Set(t.events.map((e) => e.id))).toEqual(new Set([root.id, child.id]))
    alice.close()
  })
})
