#!/usr/bin/env bun
import { resolveIdentity } from './identity.ts'
import { parseSince } from './since.ts'
import { listen } from './listen.ts'
import { post } from './commands/post.ts'
import { reply } from './commands/reply.ts'
import { dm } from './commands/dm.ts'
import { react } from './commands/react.ts'
import { thread } from './commands/thread.ts'
import { idNew } from './commands/id.ts'
import { profileGet, profileSet } from './commands/profile.ts'
import { resolvePreset, type Preset } from './forward.ts'

const HELP = `\
hopstr — Nostr daemon CLI

Usage:
  hopstr id new [--save] [--json]
  hopstr listen [--json] [--relay wss://...] [--since <when>]
                [--agent <name> | --exec '<cmd>'] [--max-concurrency <n>]
  hopstr post <content> [--json] [--relay wss://...]
  hopstr reply <event-id> <content> [--json] [--relay wss://...]
  hopstr dm <npub> <message> [--json] [--relay wss://...]
  hopstr react <event-id> [emoji] [--json] [--relay wss://...]
  hopstr thread <event-id> [--json] [--relay wss://...]
  hopstr profile get [<pubkey-or-npub>] [--json] [--relay wss://...]
  hopstr profile set --name "..." [--about "..."] [--picture <url>] [--replace] [--json]

Identity (in priority order):
  NOSTR_NSEC env var
  ~/.config/hopstr/config.json  →  { "nsec": "nsec1..." }

Options:
  --json              Output one JSON object per line (machine-readable)
  --save              For id new: write the new nsec to the config file
  --relay <url>       Add relay (repeatable); replaces defaults when provided
  --since <when>      When to listen from (default: now). Accepts: unix timestamp,
                      relative (1h, 2d ago, 30m), ISO date (2025-06-01),
                      or natural (yesterday, last week, last month)
  --agent <name>      For listen: forward dm/mention/reply text to a coding-agent CLI.
                      Presets: claude, codex, gemini, copilot, aider, cursor, amp, opencode
  --exec '<cmd>'      For listen: forward to any command. Put {} where the prompt goes;
                      omit {} to pipe the prompt to stdin. Mutually exclusive with --agent.
  --max-concurrency <n>  For listen: max parallel agent processes (default 4); excess queues
  --help, -h          Show this help

Examples:
  hopstr id new --save
  hopstr listen
  hopstr listen --json | jq .
  hopstr listen --agent claude
  hopstr listen --exec 'mytool run {}' --max-concurrency 2
  hopstr post "hello nostr"
  hopstr dm npub1xyz... "hey!"
  hopstr react nevent1abc... 🤙
  hopstr thread nevent1abc...
  hopstr profile get
  hopstr profile set --name "Alice" --about "building on nostr"
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

// Read a `--flag value` / `--flag=value` from leftover positional args. Used for
// listen-local flags (--agent/--exec/--max-concurrency) that parseArgs leaves in `args`,
// mirroring how `id new --save` reads its flag locally.
function flagValue(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(name + '='))
  if (eq) return eq.slice(name.length + 1)
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

// Whether the flag was passed at all (even with an empty value), so `--exec ''`
// is validated rather than silently treated as "no forwarding".
function hasFlag(args: string[], name: string): boolean {
  return args.includes(name) || args.some((a) => a.startsWith(name + '='))
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

  if (cmd === 'id') {
    const sub = args[0]
    if (sub !== 'new') { console.error('usage: hopstr id new [--save] [--json]'); process.exit(1) }
    const save = args.includes('--save') // --save isn't a global flag, so read it here
    await idNew({ json, save })
    return
  }

  if (cmd === 'profile') {
    const sub = args[0]
    // global --json/--relay are stripped by parseArgs; for `get` the leftover
    // positional is the target (or none → self), for `set` the rest are field flags.
    if (sub === 'get') {
      const identity = await resolveIdentity()
      await profileGet(identity, args[1], opts)
      return
    }
    if (sub === 'set') {
      const identity = await resolveIdentity()
      await profileSet(identity, args.slice(1), opts)
      return
    }
    console.error('usage: hopstr profile get [<pubkey-or-npub>]')
    console.error('       hopstr profile set --name "Alice" [--about …] [--picture …] [--replace]')
    process.exit(1)
  }

  if (cmd === 'listen') {
    const identity = await resolveIdentity()
    const agent = flagValue(args, '--agent')
    const exec = flagValue(args, '--exec')
    const mcRaw = flagValue(args, '--max-concurrency')

    let preset: Preset | undefined
    // Use presence (a flag passed empty is still an error), not truthiness.
    if (hasFlag(args, '--agent') || hasFlag(args, '--exec')) {
      try {
        preset = resolvePreset(agent, exec) // throws on both / unknown / empty
      } catch (e) {
        console.error(`error: ${e instanceof Error ? e.message : String(e)}`)
        process.exit(1)
      }
    }

    let maxConcurrency: number | undefined
    if (mcRaw !== undefined) {
      const n = Number(mcRaw)
      if (!Number.isInteger(n) || n < 1) { console.error('error: --max-concurrency must be a positive integer'); process.exit(1) }
      maxConcurrency = n
    }

    const listenOpts: { json: boolean; relays?: string[]; since?: number; preset?: Preset; maxConcurrency?: number } = { json }
    if (relays.length) listenOpts.relays = relays
    if (since !== undefined) listenOpts.since = since
    if (preset) listenOpts.preset = preset
    if (maxConcurrency !== undefined) listenOpts.maxConcurrency = maxConcurrency
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

  if (cmd === 'thread') {
    const [eventId] = args
    if (!eventId) { console.error('usage: hopstr thread <event-id>'); process.exit(1) }
    const identity = await resolveIdentity()
    await thread(identity, eventId, opts)
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
