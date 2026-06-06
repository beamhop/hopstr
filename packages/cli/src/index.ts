#!/usr/bin/env bun
import { resolveIdentity } from './identity.ts'
import { parseSince } from './since.ts'
import { listen } from './listen.ts'
import { post } from './commands/post.ts'
import { reply } from './commands/reply.ts'
import { dm } from './commands/dm.ts'
import { react } from './commands/react.ts'

const HELP = `\
hopstr — Nostr daemon CLI

Usage:
  hopstr listen [--json] [--relay wss://...] [--since <unix-timestamp>]
  hopstr post <content> [--json] [--relay wss://...]
  hopstr reply <event-id> <content> [--json] [--relay wss://...]
  hopstr dm <npub> <message> [--json] [--relay wss://...]
  hopstr react <event-id> [emoji] [--json] [--relay wss://...]

Identity (in priority order):
  NOSTR_NSEC env var
  ~/.config/hopstr/config.json  →  { "nsec": "nsec1..." }

Options:
  --json              Output one JSON object per line (machine-readable)
  --relay <url>       Add relay (repeatable); replaces defaults when provided
  --since <when>      When to listen from (default: now). Accepts: unix timestamp,
                      relative (1h, 2d ago, 30m), ISO date (2025-06-01),
                      or natural (yesterday, last week, last month)
  --help, -h          Show this help

Examples:
  hopstr listen
  hopstr listen --json | jq .
  hopstr post "hello nostr"
  hopstr dm npub1xyz... "hey!"
  hopstr react nevent1abc... 🤙
`

function parseArgs(argv: string[]): { cmd: string; args: string[]; json: boolean; relays: string[]; since?: number } {
  const relays: string[] = []
  const rest: string[] = []
  let json = false
  let since: number | undefined

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--json') { json = true; continue }
    if (a === '--relay' || a === '-r') { if (argv[i + 1]) relays.push(argv[++i]!); continue }
    if (a.startsWith('--relay=')) { relays.push(a.slice(8)); continue }
    if (a === '--since') { if (argv[i + 1]) since = parseSince(argv[++i]!); continue }
    if (a.startsWith('--since=')) { since = parseSince(a.slice(8)); continue }
    rest.push(a)
  }

  const [cmd = '', ...args] = rest
  const parsed: { cmd: string; args: string[]; json: boolean; relays: string[]; since?: number } = { cmd, args, json, relays }
  if (since !== undefined) parsed.since = since
  return parsed
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP)
    process.exit(0)
  }

  const { cmd, args, json, relays, since } = parseArgs(argv)
  // Build opts with keys present only when set — under exactOptionalPropertyTypes an
  // explicit `undefined` isn't assignable to an optional `relays?`/`since?` field.
  const opts: { json: boolean; relays?: string[] } = { json }
  if (relays.length) opts.relays = relays

  if (cmd === 'listen') {
    const identity = await resolveIdentity()
    const listenOpts: { json: boolean; relays?: string[]; since?: number } = { json }
    if (relays.length) listenOpts.relays = relays
    if (since !== undefined) listenOpts.since = since
    await listen(identity, listenOpts)
    return
  }

  if (cmd === 'post') {
    const content = args[0]
    if (!content) { console.error('usage: hopstr post <content>'); process.exit(1) }
    const identity = await resolveIdentity()
    await post(identity, content, opts)
    return
  }

  if (cmd === 'reply') {
    const [eventId, content] = args
    if (!eventId || !content) { console.error('usage: hopstr reply <event-id> <content>'); process.exit(1) }
    const identity = await resolveIdentity()
    await reply(identity, eventId, content, opts)
    return
  }

  if (cmd === 'dm') {
    const [npub, message] = args
    if (!npub || !message) { console.error('usage: hopstr dm <npub> <message>'); process.exit(1) }
    const identity = await resolveIdentity()
    await dm(identity, npub, message, opts)
    return
  }

  if (cmd === 'react') {
    const [eventId, emoji = '+'] = args
    if (!eventId) { console.error('usage: hopstr react <event-id> [emoji]'); process.exit(1) }
    const identity = await resolveIdentity()
    await react(identity, eventId, emoji, opts)
    return
  }

  console.error(`unknown command: ${cmd}`)
  console.error('run `hopstr --help` for usage')
  process.exit(1)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
