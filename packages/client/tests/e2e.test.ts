// End-to-end: the whole stack (core → signer → pool → router → store → client)
// driving a real WebSocket relay in-process. Proves the integrated happy path.
import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Nostr } from '../src/client.ts'
import { startRelay, type MockRelay } from './relay-harness.ts'

let r: MockRelay
beforeAll(() => {
  r = startRelay()
})
afterAll(() => r.stop())

test('post → subscribe-back → read from store, end to end', async () => {
  const alice = await Nostr.create({ relays: [r.url], outbox: false })

  // 1) publish a note (optimistic store + real relay round-trip)
  const post = alice.note('gm from the full Velvet stack')
  const event = await post.event()
  const results = await post
  expect(results).toEqual([{ relay: r.url, ok: true, reason: '' }])

  // 2) a second client subscribes and reads it back off the wire
  const bob = await Nostr.create({ relays: [r.url], readOnly: true })
  const got = await bob.notes({ authors: [event.pubkey] }).take(1)
  expect(got[0]?.id).toBe(event.id)
  expect(got[0]?.content).toBe('gm from the full Velvet stack')

  // 3) bob's store now holds it (subscribe mirrors into the store)
  expect(bob.store.get(event.id)?.content).toBe('gm from the full Velvet stack')

  alice.close()
  bob.close()
})
