import { NostrClient } from '@hopstr/agent'
import type { Identity } from '@hopstr/core'

// Well-known kind-0 fields (NIP-01 + NIP-24 + universally-used), in display order.
// We don't restrict to these — setProfile accepts any field — but these are the
// ones we label nicely in `get` and coerce in `set`.
//   NIP-01: name, about, picture          https://nips.nostr.com/1
//   NIP-24: display_name, website, banner, bot   https://nips.nostr.com/24
export const KNOWN_FIELDS = [
  'name',
  'display_name',
  'about',
  'website',
  'nip05',
  'lud16',
  'lud06',
  'picture',
  'banner',
  'bot',
] as const

/** Coerce a raw CLI string to the right type. `bot` is the only boolean field. */
export function coerceValue(field: string, value: string): unknown {
  if (field === 'bot') return value.toLowerCase() === 'true'
  return value
}

/**
 * Parse `--key value` / `--key=value` pairs from the raw `set` args into a changes
 * object, plus the `--replace` flag. Coerces known typed fields. Global flags
 * (--json/--relay/-r/--since) are normally stripped upstream; we skip them here too
 * so the helper is safe to call with raw argv.
 */
export function parseSetArgs(args: string[]): { changes: Record<string, unknown>; replace: boolean } {
  const changes: Record<string, unknown> = {}
  let replace = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (a === '--replace') { replace = true; continue }
    if (a === '--json') continue
    if (a === '--relay' || a === '-r' || a === '--since') { i++; continue }
    if (a.startsWith('--relay=') || a.startsWith('--since=')) continue
    if (!a.startsWith('--')) continue // no positional fields in `set`
    const eq = a.indexOf('=')
    if (eq !== -1) {
      const key = a.slice(2, eq)
      changes[key] = coerceValue(key, a.slice(eq + 1))
      continue
    }
    const key = a.slice(2)
    const next = args[i + 1]
    if (next === undefined || next.startsWith('--')) {
      changes[key] = coerceValue(key, '') // bare flag → empty (clears the field)
    } else {
      changes[key] = coerceValue(key, next)
      i++
    }
  }
  return { changes, replace }
}

/**
 * Produce the metadata object to publish. By default merge `changes` onto the
 * current profile; with `replace`, use only `changes`. An empty-string value
 * DELETES that key (so we never publish empty fields).
 */
export function applyChanges(
  current: Record<string, unknown> | null,
  changes: Record<string, unknown>,
  replace: boolean,
): Record<string, unknown> {
  const merged = replace ? {} : { ...(current ?? {}) }
  for (const [key, value] of Object.entries(changes)) {
    if (value === '') delete merged[key]
    else merged[key] = value
  }
  return merged
}

/** Human-readable rendering of a profile's fields. Pure — returns lines. */
export function formatProfile(meta: Record<string, unknown> | null): string[] {
  if (meta === null) return ['(no profile set)']
  const seen = new Set<string>()
  const lines: string[] = []
  const add = (key: string): void => {
    const v = meta[key]
    if (v === undefined || v === '') return
    seen.add(key)
    lines.push(`${key.padEnd(13)} ${formatValue(v)}`)
  }
  for (const field of KNOWN_FIELDS) add(field)
  for (const key of Object.keys(meta)) if (!seen.has(key)) add(key) // surface extras too
  return lines.length ? lines : ['(empty profile)']
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'boolean' || typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

/**
 * `hopstr profile get [pubkey-or-npub]` — show a profile (your own by default).
 * --json prints the raw metadata object ({} when absent); human prints labelled
 * fields or "(no profile set)".
 */
export async function profileGet(
  identity: Identity,
  target: string | undefined,
  opts: { json: boolean; relays?: string[] },
): Promise<void> {
  const who = target && target.trim() ? target : identity.npub
  const client = new NostrClient(identity, opts.relays)
  const meta = await client.getProfile(who)
  client.close()

  if (opts.json) {
    process.stdout.write(JSON.stringify(meta ?? {}) + '\n')
    return
  }
  for (const line of formatProfile(meta)) console.log(line)
}

/**
 * `hopstr profile set --<field> <value> … [--replace]` — update your own profile.
 * Merges onto the current profile by default (setting one field never wipes the
 * others); --replace overwrites with exactly the given fields. An empty value
 * clears the field. --json prints the PublishOk.
 */
export async function profileSet(
  identity: Identity,
  setArgs: string[],
  opts: { json: boolean; relays?: string[] },
): Promise<void> {
  const { changes, replace } = parseSetArgs(setArgs)
  if (Object.keys(changes).length === 0) {
    console.error('usage: hopstr profile set --name "Alice" [--about …] [--picture …] [--replace]')
    process.exit(1)
  }

  const client = new NostrClient(identity, opts.relays)
  const current = replace ? null : await client.getProfile(identity.npub)
  const result = await client.setProfile(applyChanges(current, changes, replace))
  client.close()

  if (opts.json) {
    process.stdout.write(JSON.stringify(result) + '\n')
  } else {
    console.log(`updated profile: ${result.id}`)
  }
}
