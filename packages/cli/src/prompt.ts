import type { FormattedEvent } from './format.ts'

// Build the prompt handed to the agent. Without --reply it's just the raw message
// text (fire-and-forget, agent's output is discarded). With --reply we wrap the text
// with the sender's context and the exact `hopstr` command the agent should run to
// answer — the agent inherits the same NOSTR_NSEC, so its `hopstr` posts as us.
export function buildPrompt(ev: FormattedEvent, reply: boolean): string {
  const text = ev.content ?? ev.text ?? ''
  if (!reply) return text

  // dm → answer with a DM to the sender; mention/reply → threaded reply to the note.
  const answer =
    ev.type === 'dm'
      ? `hopstr dm ${ev.from} "<your reply>"`
      : `hopstr reply ${ev.id} "<your reply>"`

  const kind = ev.type === 'dm' ? 'direct message' : ev.type

  return [
    `You are a Nostr bot. You just received a ${kind} from ${ev.from}:`,
    '',
    text,
    '',
    `Decide how to respond, then send your reply by running this command (it posts as you):`,
    `  ${answer}`,
    `Run that command yourself. Replace <your reply> with your message; keep it to a single command.`,
    `If no reply is warranted, do nothing.`,
  ].join('\n')
}
