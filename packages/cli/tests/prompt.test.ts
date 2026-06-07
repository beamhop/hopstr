import { describe, test, expect } from 'bun:test'
import { buildPrompt } from '../src/prompt.ts'
import type { FormattedEvent } from '../src/format.ts'

const NPUB = 'npub1mn02zpkexampleexampleexampleexampleexampleexampleexampleex'
const ID = 'a'.repeat(64)

const dm: FormattedEvent = { type: 'dm', from: NPUB, text: 'tell me a story', at: 1, dmKind: 'nip17' }
const mention: FormattedEvent = { type: 'mention', from: NPUB, id: ID, content: 'gm @you', at: 1 }
const reply: FormattedEvent = { type: 'reply', from: NPUB, id: ID, content: 'agreed', at: 1 }

describe('buildPrompt — no reply (raw text)', () => {
  test('dm → just the text', () => {
    expect(buildPrompt(dm, false)).toBe('tell me a story')
  })
  test('mention → just the content', () => {
    expect(buildPrompt(mention, false)).toBe('gm @you')
  })
  test('missing text → empty string (caller guards on it)', () => {
    expect(buildPrompt({ type: 'mention', from: NPUB, at: 1 }, false)).toBe('')
  })
})

describe('buildPrompt — reply mode', () => {
  test('dm → instructs `hopstr dm <npub>` and includes the text', () => {
    const p = buildPrompt(dm, true)
    expect(p).toContain('tell me a story')
    expect(p).toContain(`hopstr dm ${NPUB} "<your reply>"`)
    expect(p).toContain('direct message')
    expect(p).not.toContain('hopstr reply')
  })

  test('mention → instructs `hopstr reply <event-id>`', () => {
    const p = buildPrompt(mention, true)
    expect(p).toContain('gm @you')
    expect(p).toContain(`hopstr reply ${ID} "<your reply>"`)
    expect(p).not.toContain('hopstr dm')
  })

  test('reply → also uses `hopstr reply <event-id>`', () => {
    const p = buildPrompt(reply, true)
    expect(p).toContain(`hopstr reply ${ID} "<your reply>"`)
  })

  test('reply mode still embeds the raw message text verbatim', () => {
    const tricky: FormattedEvent = { type: 'dm', from: NPUB, text: 'line1\nline2 "quoted"', at: 1, dmKind: 'nip17' }
    expect(buildPrompt(tricky, true)).toContain('line1\nline2 "quoted"')
  })
})
