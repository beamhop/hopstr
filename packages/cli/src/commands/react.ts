import { NostrClient } from '@hopstr/agent'
import type { Identity } from '@hopstr/core'

export async function react(identity: Identity, eventId: string, emoji: string, opts: { json: boolean; relays?: string[] }): Promise<void> {
  const client = new NostrClient(identity, opts.relays)
  const result = await client.react(eventId, emoji)
  client.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    console.log(`reacted ${emoji}: ${result.id}`)
  }
}
