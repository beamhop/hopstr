// The autonomous loop: subscribe to notes, ask a brain (the GitHub Copilot CLI)
// how a thoughtful person would respond, and act (reply/react/ignore). The brain
// is injectable so the loop is testable without the `copilot` binary.
import type { NostrEvent } from '@hopstr/core'
import type { NostrClient, FeedNote } from './facade.ts'

export interface Persona {
  about?: string
  model?: string
}

export type Decision =
  | { action: 'reply'; text: string; reason: string }
  | { action: 'react'; emoji: string; reason: string }
  | { action: 'ignore'; reason: string }

/** Runs a prompt through a brain and returns its raw text reply. */
export type CopilotRunner = (prompt: string, model?: string) => Promise<string>

/** Default runner: shell out to the GitHub Copilot CLI. */
export const copilotRunner: CopilotRunner = async (prompt, model) => {
  const args = ['-p', prompt, '--output-format', 'json', '--allow-all-tools']
  if (model) args.push('--model', model)
  const proc = Bun.spawn(['copilot', ...args], { stdout: 'pipe', stderr: 'pipe' })
  const out = await new Response(proc.stdout).text()
  const code = await proc.exited
  if (code !== 0) {
    const err = await new Response(proc.stderr).text()
    throw new Error(`copilot exited ${code}: ${err.slice(0, 200)}`)
  }
  return extractContent(out)
}

/** Pull the final assistant message text out of copilot's JSONL stream. */
export function extractContent(jsonl: string): string {
  let last = ''
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as { role?: string; message?: string; type?: string; content?: string }
      const msg = obj.message ?? obj.content
      if ((obj.role === 'assistant' || obj.type === 'assistant') && typeof msg === 'string') last = msg
    } catch {
      // not a JSON line
    }
  }
  return last
}

/** Parse a single-line JSON decision out of arbitrary brain text. */
export function parseDecision(text: string): Decision {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { action: 'ignore', reason: 'no decision found' }
  try {
    const d = JSON.parse(match[0]) as Partial<Decision> & { action?: string }
    if (d.action === 'reply' && typeof (d as { text?: string }).text === 'string') {
      return { action: 'reply', text: (d as { text: string }).text, reason: d.reason ?? '' }
    }
    if (d.action === 'react' && typeof (d as { emoji?: string }).emoji === 'string') {
      return { action: 'react', emoji: (d as { emoji: string }).emoji, reason: d.reason ?? '' }
    }
    return { action: 'ignore', reason: d.reason ?? 'ignored' }
  } catch {
    return { action: 'ignore', reason: 'unparseable decision' }
  }
}

function buildPrompt(note: FeedNote, persona: Persona): string {
  const about = persona.about ?? 'a friendly, thoughtful person on Nostr'
  return [
    `You are ${about}. Read this Nostr note and decide how to respond.`,
    `Note from ${note.author}: ${JSON.stringify(note.content)}`,
    `Reply ONLY with a single-line JSON object, one of:`,
    `{"action":"reply","text":"...","reason":"..."}`,
    `{"action":"react","emoji":"...","reason":"..."}`,
    `{"action":"ignore","reason":"..."}`,
  ].join('\n')
}

/** Ask the brain for a decision about one note. */
export async function decide(
  note: FeedNote,
  persona: Persona = {},
  runner: CopilotRunner = copilotRunner,
): Promise<Decision> {
  const text = await runner(buildPrompt(note, persona), persona.model)
  return parseDecision(text)
}

export interface RunAgentOptions {
  persona?: Persona
  /** "mentions" reacts to your notifications; "feed" reacts to everything. */
  watch?: 'mentions' | 'feed'
  /** Called with each decision (for monitoring). */
  onDecision?: (note: FeedNote, decision: Decision) => void
  /** Inject the brain (tests pass a fake). */
  runner?: CopilotRunner
}

/**
 * Run the closed loop. Subscribes to live notes, decides per note, and acts.
 * Never replies to its own notes; acts on each note once. Returns a stop().
 */
export function runAgent(client: NostrClient, options: RunAgentOptions = {}): () => void {
  const watch = options.watch ?? 'mentions'
  const runner = options.runner ?? copilotRunner
  const seen = new Set<string>()
  const filter =
    watch === 'mentions' ? { kinds: [1], '#p': [client.pubkey] } : { kinds: [1] }

  const stop = client.subscribe(filter as never, (event: NostrEvent) => {
    if (event.pubkey === client.pubkey || seen.has(event.id)) return
    seen.add(event.id)
    const note: FeedNote = {
      id: event.id,
      author: event.pubkey,
      created_at: event.created_at,
      content: event.content,
      tags: event.tags,
    }
    void act(client, note, options.persona ?? {}, runner, options.onDecision)
  })
  return stop
}

async function act(
  client: NostrClient,
  note: FeedNote,
  persona: Persona,
  runner: CopilotRunner,
  onDecision?: (note: FeedNote, decision: Decision) => void,
): Promise<void> {
  const decision = await decide(note, persona, runner)
  onDecision?.(note, decision)
  if (decision.action === 'reply') await client.reply(note.id, decision.text)
  else if (decision.action === 'react') await client.react(note.id, decision.emoji)
}
