import { describe, test, expect } from 'bun:test'
import { buildPrompt } from '../src/prompt.ts'
import type { FormattedEvent } from '../src/format.ts'

const NPUB = 'npub1mn02zpkexampleexampleexampleexampleexampleexampleexampleex'
const ID = 'a'.repeat(64)

const dm: FormattedEvent = { type: 'dm', from: NPUB, text: 'tell me a story', at: 1, dmKind: 'nip17' }
const mention: FormattedEvent = { type: 'mention', from: NPUB, id: ID, content: 'gm @you', at: 1 }
const reply: FormattedEvent = { type: 'reply', from: NPUB, id: ID, content: 'agreed', at: 1 }

describe('buildPrompt', () => {
  test('dm → instructs `hopstr dm <npub>` and includes the text', () => {
    const p = buildPrompt(dm)
    expect(p).toContain('tell me a story')
    expect(p).toContain(`hopstr dm ${NPUB} "<your reply>"`)
    expect(p).toContain('direct message')
    expect(p).not.toContain('hopstr reply')
  })

  test('mention → instructs `hopstr reply <event-id>`', () => {
    const p = buildPrompt(mention)
    expect(p).toContain('gm @you')
    expect(p).toContain(`hopstr reply ${ID} "<your reply>"`)
    expect(p).not.toContain('hopstr dm')
  })

  test('reply → also uses `hopstr reply <event-id>`', () => {
    expect(buildPrompt(reply)).toContain(`hopstr reply ${ID} "<your reply>"`)
  })

  test('embeds the raw message text verbatim (newlines, quotes)', () => {
    const tricky: FormattedEvent = { type: 'dm', from: NPUB, text: 'line1\nline2 "quoted"', at: 1, dmKind: 'nip17' }
    expect(buildPrompt(tricky)).toContain('line1\nline2 "quoted"')
  })

  test('missing text → still a valid prompt (empty message body)', () => {
    const p = buildPrompt({ type: 'mention', from: NPUB, id: ID, at: 1 })
    expect(p).toContain('You are a Nostr bot')
    expect(p).toContain(`hopstr reply ${ID} "<your reply>"`)
  })
})
