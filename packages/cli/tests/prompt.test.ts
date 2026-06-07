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

  test('embeds the full raw event as a pretty JSON fenced block when present', () => {
    const raw = { id: ID, pubkey: 'p'.repeat(64), kind: 1, tags: [['p', 'q']], content: 'gm @you', created_at: 1, sig: 's'.repeat(128) }
    const p = buildPrompt({ ...mention, raw })
    expect(p).toContain('Full raw event:')
    expect(p).toContain('```json')
    // pretty-printed (2-space indent), so a nested field appears on its own line
    expect(p).toContain(JSON.stringify(raw, null, 2))
    expect(p).toContain('"sig": "ssss')
    expect(p).toContain('"tags": [')
  })

  test('no raw → no JSON block, prompt still complete', () => {
    const p = buildPrompt(mention)
    expect(p).not.toContain('Full raw event:')
    expect(p).not.toContain('```json')
    expect(p).toContain(`hopstr reply ${ID} "<your reply>"`)
  })

  test('dm raw is embedded too (decrypted inner event)', () => {
    const raw = { from: 'p'.repeat(64), to: ['q'.repeat(64)], text: 'tell me a story', at: 1 }
    const p = buildPrompt({ ...dm, raw })
    expect(p).toContain('Full raw event:')
    expect(p).toContain('"text": "tell me a story"')
    expect(p).toContain(`hopstr dm ${NPUB} "<your reply>"`)
  })
})
