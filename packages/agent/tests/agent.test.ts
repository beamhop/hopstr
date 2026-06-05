// The autonomous loop, driven by a fake brain (no real copilot binary).
import { afterEach, describe, expect, test } from 'bun:test'
import { createIdentity, type NostrEvent } from '@nostragent/core'
import { NostrClient } from '../src/facade.ts'
import { decide, extractContent, parseDecision, runAgent, type CopilotRunner, type FeedNote } from '../src/index.ts'
import { startRelay, type MockRelay } from './relay-harness.ts'

const relays: MockRelay[] = []
afterEach(() => {
  while (relays.length) relays.pop()!.stop()
})

const note: FeedNote = { id: 'ab'.repeat(32), author: 'cd'.repeat(32), created_at: 1, content: 'gm', tags: [] }

describe('extractContent', () => {
  test('pulls the last assistant message from a JSONL stream', () => {
    const jsonl = [
      JSON.stringify({ role: 'system', message: 'ignored' }),
      JSON.stringify({ type: 'assistant', message: '{"action":"ignore","reason":"first"}' }),
      '   ',
      'not json',
      JSON.stringify({ role: 'assistant', message: '{"action":"reply","text":"hi","reason":"final"}' }),
    ].join('\n')
    expect(extractContent(jsonl)).toContain('final')
  })
  test('empty stream → empty', () => {
    expect(extractContent('\n\n')).toBe('')
  })
})

describe('parseDecision', () => {
  test('reply / react / ignore', () => {
    expect(parseDecision('{"action":"reply","text":"hi","reason":"r"}')).toEqual({ action: 'reply', text: 'hi', reason: 'r' })
    expect(parseDecision('blah {"action":"react","emoji":"🔥","reason":"r"} trailing')).toEqual({ action: 'react', emoji: '🔥', reason: 'r' })
    expect(parseDecision('{"action":"ignore","reason":"meh"}')).toEqual({ action: 'ignore', reason: 'meh' })
  })
  test('malformed / missing fields → ignore', () => {
    expect(parseDecision('no json here').action).toBe('ignore')
    expect(parseDecision('{bad json}').action).toBe('ignore')
    expect(parseDecision('{"action":"reply"}').action).toBe('ignore') // missing text
    expect(parseDecision('{"action":"react"}').action).toBe('ignore') // missing emoji
    expect(parseDecision('{"action":"weird"}').action).toBe('ignore')
  })
})

describe('decide', () => {
  test('runs the brain and parses its decision', async () => {
    const runner: CopilotRunner = async (prompt, model) => {
      expect(prompt).toContain('gm')
      expect(model).toBe('gpt-5.2')
      return '{"action":"reply","text":"gm fren","reason":"friendly"}'
    }
    const d = await decide(note, { about: 'a cheerful dev', model: 'gpt-5.2' }, runner)
    expect(d).toEqual({ action: 'reply', text: 'gm fren', reason: 'friendly' })
  })
})

describe('runAgent', () => {
  function setup() {
    const r = startRelay()
    relays.push(r)
    const agent = new NostrClient(createIdentity(), [r.url])
    const other = new NostrClient(createIdentity(), [r.url])
    return { r, agent, other }
  }

  test('reacts to a mention by replying, never to its own notes', async () => {
    const { agent, other } = setup()
    const decisions: Array<{ note: FeedNote; action: string }> = []
    const runner: CopilotRunner = async () => '{"action":"reply","text":"thanks!","reason":"polite"}'
    const stop = runAgent(agent, {
      watch: 'mentions',
      runner,
      onDecision: (n, d) => decisions.push({ note: n, action: d.action }),
    })

    // someone mentions the agent
    await other.post(`hey ${agent.npub}`, [['p', agent.pubkey]])
    // the agent posts something itself (must be ignored by the loop)
    await agent.post('my own note', [['p', agent.pubkey]])

    await new Promise((r2) => setTimeout(r2, 150))
    stop()

    expect(decisions.some((d) => d.action === 'reply')).toBe(true)
    expect(decisions.every((d) => d.note.author !== agent.pubkey)).toBe(true)
    agent.close()
    other.close()
  })

  test('feed mode + react action; acts on each note once', async () => {
    const { agent, other } = setup()
    let calls = 0
    const runner: CopilotRunner = async () => {
      calls++
      return '{"action":"react","emoji":"👍","reason":"nice"}'
    }
    const stop = runAgent(agent, { watch: 'feed', runner })
    await other.post('something interesting')
    await new Promise((r2) => setTimeout(r2, 150))
    // a second identical subscription delivery shouldn't double-act (seen set)
    stop()
    expect(calls).toBeGreaterThanOrEqual(1)
    agent.close()
    other.close()
  })
})
