import type { FormattedEvent } from './format.ts'

// Build the prompt handed to the agent: the sender's message plus the exact `hopstr`
// command to answer with. The agent inherits our NOSTR_NSEC, so its `hopstr` posts as
// us — that's how activating an agent makes it react on Nostr by default.
export function buildPrompt(ev: FormattedEvent): string {
  const text = ev.content ?? ev.text ?? ''

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
