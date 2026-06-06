import { NostrClient } from '@hopstr/agent'
import type { Identity } from '@hopstr/core'

export async function dm(identity: Identity, npub: string, text: string, opts: { json: boolean; relays?: string[] }): Promise<void> {
  const client = new NostrClient(identity, opts.relays)
  const result = await client.sendDM(npub, text)
  client.close()
  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    console.log(`sent dm: ${result.id}`)
  }
}
