import { NostrClient } from '@hopstr/agent'
import type { Identity } from '@hopstr/core'

export async function reply(identity: Identity, eventId: string, content: string, opts: { json: boolean; relays?: string[] }): Promise<void> {
  const client = new NostrClient(identity, opts.relays)
  const result = await client.reply(eventId, content)
  client.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    console.log(`replied: ${result.id}`)
  }
}
