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

  // The full event so the agent can inspect tags, kind, timestamps, etc. — not just
  // the bare text. For DMs this is the decrypted inner event (the encrypted wire
  // wrapper is omitted upstream). Pretty-printed in a fenced block so it's readable
  // both to the agent and in the daemon's streamed output.
  const rawBlock =
    ev.raw === undefined
      ? []
      : ['', 'Full raw event:', '```json', JSON.stringify(ev.raw, null, 2), '```']

  return [
    `You are a Nostr bot. You just received a ${kind} from ${ev.from}:`,
    '',
    text,
    ...rawBlock,
    '',
    `Decide how to respond, then send your reply by running this command (it posts as you):`,
    `  ${answer}`,
    `Run that command yourself. Replace <your reply> with your message; keep it to a single command.`,
    `If no reply is warranted, do nothing.`,
  ].join('\n')
}
