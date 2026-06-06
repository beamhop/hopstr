import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { prettyPrint, jsonLine, type FormattedEvent } from '../src/format.ts'

const NOW = Math.floor(Date.now() / 1000)

const mention: FormattedEvent = {
  type: 'mention',
  from: 'npub1abcdefghijklmnopqrstuvwxyz012345678901234567890123456789012345',
  id: 'abc123',
  content: 'hello nostr',
  at: NOW - 5,
}

const dmEvent: FormattedEvent = {
  type: 'dm',
  from: 'npub1abcdefghijklmnopqrstuvwxyz012345678901234567890123456789012345',
  text: 'secret message',
  at: NOW - 120,
  dmKind: 'nip17',
}

const reaction: FormattedEvent = {
  type: 'reaction',
  from: 'npub1abcdefghijklmnopqrstuvwxyz012345678901234567890123456789012345',
  emoji: '🤙',
  targetId: 'eventabc',
  at: NOW - 3600,
}

describe('jsonLine', () => {
  let captured = ''
  const orig = process.stdout.write.bind(process.stdout)

  beforeEach(() => {
    captured = ''
    process.stdout.write = (s: string) => { captured += s; return true }
  })
  afterEach(() => { process.stdout.write = orig })

  test('emits valid JSON for mention', () => {
    jsonLine(mention)
    const parsed = JSON.parse(captured.trim())
    expect(parsed.type).toBe('mention')
    expect(parsed.content).toBe('hello nostr')
  })

  test('emits valid JSON for dm', () => {
    jsonLine(dmEvent)
    const parsed = JSON.parse(captured.trim())
    expect(parsed.type).toBe('dm')
    expect(parsed.text).toBe('secret message')
    expect(parsed.dmKind).toBe('nip17')
  })

  test('emits valid JSON for reaction', () => {
    jsonLine(reaction)
    const parsed = JSON.parse(captured.trim())
    expect(parsed.type).toBe('reaction')
    expect(parsed.emoji).toBe('🤙')
  })

  test('each call emits exactly one newline-terminated line', () => {
    jsonLine(mention)
    expect(captured.endsWith('\n')).toBe(true)
    expect(captured.split('\n').filter(Boolean)).toHaveLength(1)
  })
})

describe('prettyPrint', () => {
  const lines: string[] = []
  const origLog = console.log

  beforeEach(() => {
    lines.length = 0
    console.log = (...args: unknown[]) => lines.push(args.join(' '))
  })
  afterEach(() => { console.log = origLog })

  test('mention includes [mention] label and content', () => {
    prettyPrint(mention)
    expect(lines.some((l) => l.includes('[mention]'))).toBe(true)
    expect(lines.some((l) => l.includes('hello nostr'))).toBe(true)
  })

  test('dm includes [dm] label and text', () => {
    prettyPrint(dmEvent)
    expect(lines.some((l) => l.includes('[dm]'))).toBe(true)
    expect(lines.some((l) => l.includes('secret message'))).toBe(true)
  })

  test('reaction includes [reaction] label and emoji', () => {
    prettyPrint(reaction)
    expect(lines.some((l) => l.includes('[reaction]'))).toBe(true)
    expect(lines.some((l) => l.includes('🤙'))).toBe(true)
  })

  test('relative time: 5s ago', () => {
    prettyPrint(mention)
    expect(lines.some((l) => l.includes('s ago'))).toBe(true)
  })

  test('relative time: 2m ago', () => {
    prettyPrint(dmEvent)
    expect(lines.some((l) => l.includes('m ago'))).toBe(true)
  })

  test('relative time: 1h ago', () => {
    prettyPrint(reaction)
    expect(lines.some((l) => l.includes('h ago'))).toBe(true)
  })
})
