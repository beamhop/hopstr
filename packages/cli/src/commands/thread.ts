import { NostrClient, type ThreadNode } from '@hopstr/agent'
import { nip19, type Identity } from '@hopstr/core'

export async function thread(identity: Identity, eventId: string, opts: { json: boolean; relays?: string[] }): Promise<void> {
  const client = new NostrClient(identity, opts.relays)
  const result = await client.thread(eventId)

  if (opts.json) {
    client.close()
    // Nested tree only — the full conversation rooted at `root`, plus the node the
    // user asked about (`target`). Consumers walk `tree` and compare against target.id.
    process.stdout.write(JSON.stringify({ root: result.root, target: result.target, tree: result.tree }) + '\n')
    return
  }

  // Resolve each unique author to a display name once, falling back to a short npub.
  const names = await resolveNames(client, [...new Set(result.events.map((e) => e.pubkey))])
  client.close()
  renderTree(result.tree, result.target.id, names, 0)
}

/** Fetch kind-0 names for the given pubkeys; falls back to a short npub. */
async function resolveNames(client: NostrClient, pubkeys: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all(
    pubkeys.map(async (pk) => {
      let label = shortNpub(pk)
      try {
        const profile = await client.getProfile(pk)
        const name = profile && (profile.display_name ?? profile.name)
        if (typeof name === 'string' && name.trim()) label = name.trim()
      } catch {
        // keep the npub fallback
      }
      names.set(pk, label)
    }),
  )
  return names
}

/** Render a thread node and its descendants as an indented ASCII tree. */
export function renderTree(node: ThreadNode, targetId: string, names: Map<string, string>, depth: number): void {
  const e = node.event
  const indent = '  '.repeat(depth)
  const branch = depth === 0 ? '▸' : '└─'
  const who = names.get(e.pubkey) ?? shortNpub(e.pubkey)
  const here = e.id === targetId ? '  ← you asked about this' : ''
  console.log(`${indent}${branch} ${who}: ${snippet(e.content)}  (${e.id.slice(0, 8)})${here}`)
  for (const child of node.children) renderTree(child, targetId, names, depth + 1)
}

/** A one-line, length-capped preview of an event's content. */
export function snippet(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > 60 ? oneLine.slice(0, 59) + '…' : oneLine
}

function shortNpub(pubkey: string): string {
  return nip19.encodeNpub(pubkey).slice(0, 13)
}
