export type EventType = 'mention' | 'reply' | 'dm' | 'reaction'

export interface FormattedEvent {
  type: EventType
  from: string   // npub
  id?: string
  content?: string
  text?: string  // DMs use text
  emoji?: string // reactions
  targetId?: string
  at: number
  dmKind?: 'nip17' | 'nip04'
  // The full event handed to the agent under --agent/--exec. For notes/reactions
  // it's the raw signed NIP-01 event; for DMs it's the DECRYPTED inner event
  // (readable content, real sender) — the encrypted wire wrapper is never useful.
  // Printing ignores this; only buildPrompt embeds it.
  raw?: unknown
}

function relativeTime(at: number): string {
  const diff = Math.floor(Date.now() / 1000) - at
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function shortNpub(npub: string): string {
  return `@${npub.slice(0, 12)}…`
}

const LABELS: Record<EventType, string> = {
  mention:  '[mention] ',
  reply:    '[reply]   ',
  dm:       '[dm]      ',
  reaction: '[reaction]',
}

export function prettyPrint(ev: FormattedEvent): void {
  const label = LABELS[ev.type]
  const who = shortNpub(ev.from)
  const when = relativeTime(ev.at)

  if (ev.type === 'reaction') {
    const emoji = ev.emoji === '+' ? '♥' : ev.emoji ?? '♥'
    console.log(`${label} ${who} reacted ${emoji} · ${when}`)
    return
  }

  if (ev.type === 'dm') {
    const tag = ev.dmKind === 'nip04' ? ' (legacy NIP-04)' : ' (NIP-17)'
    console.log(`${label} ${who} · ${when}${tag}`)
    console.log(`           ${ev.text ?? ''}`)
    console.log()
    return
  }

  console.log(`${label} ${who} · ${when}`)
  console.log(`           ${ev.content ?? ''}`)
  console.log()
}

export function jsonLine(ev: FormattedEvent): void {
  process.stdout.write(JSON.stringify(ev) + '\n')
}
