// Wire-message parsing + reason-prefix extraction, including all reject paths.
import { describe, expect, test } from 'bun:test'
import { parseRelayMessage, reasonPrefix, serializeClientMessage } from '../src/messages.ts'
import type { NostrEvent } from '@hopstr/core'

const ev = { id: 'a', kind: 1 } as unknown as NostrEvent

describe('parseRelayMessage', () => {
  test('valid frames', () => {
    expect(parseRelayMessage(['EVENT', 'sub', ev])).toEqual({ type: 'EVENT', sub: 'sub', event: ev })
    expect(parseRelayMessage(['OK', 'id', true, 'msg'])).toEqual({ type: 'OK', id: 'id', ok: true, reason: 'msg' })
    expect(parseRelayMessage(['OK', 'id', false])).toEqual({ type: 'OK', id: 'id', ok: false, reason: '' })
    expect(parseRelayMessage(['EOSE', 'sub'])).toEqual({ type: 'EOSE', sub: 'sub' })
    expect(parseRelayMessage(['CLOSED', 'sub', 'why'])).toEqual({ type: 'CLOSED', sub: 'sub', reason: 'why' })
    expect(parseRelayMessage(['CLOSED', 'sub'])).toEqual({ type: 'CLOSED', sub: 'sub', reason: '' })
    expect(parseRelayMessage(['NOTICE', 'hi'])).toEqual({ type: 'NOTICE', message: 'hi' })
    expect(parseRelayMessage(['AUTH', 'chal'])).toEqual({ type: 'AUTH', challenge: 'chal' })
    expect(parseRelayMessage(['COUNT', 'sub', { count: 7 }])).toEqual({ type: 'COUNT', sub: 'sub', count: 7 })
  })

  test('rejects malformed frames', () => {
    expect(parseRelayMessage([])).toBeUndefined()
    expect(parseRelayMessage('nope')).toBeUndefined()
    expect(parseRelayMessage(['EVENT', 'sub'])).toBeUndefined()
    expect(parseRelayMessage(['EVENT', 123, ev])).toBeUndefined()
    expect(parseRelayMessage(['OK', 'id', 'notbool'])).toBeUndefined()
    expect(parseRelayMessage(['EOSE', 123])).toBeUndefined()
    expect(parseRelayMessage(['CLOSED', 123])).toBeUndefined()
    expect(parseRelayMessage(['NOTICE', 123])).toBeUndefined()
    expect(parseRelayMessage(['AUTH', 123])).toBeUndefined()
    expect(parseRelayMessage(['COUNT', 'sub'])).toBeUndefined()
    expect(parseRelayMessage(['COUNT', 'sub', { nope: 1 }])).toBeUndefined()
    expect(parseRelayMessage(['UNKNOWN', 1])).toBeUndefined()
  })
})

describe('reasonPrefix', () => {
  test('extracts known prefixes', () => {
    expect(reasonPrefix('auth-required: do it')).toBe('auth-required')
    expect(reasonPrefix('restricted: nope')).toBe('restricted')
    expect(reasonPrefix('rate-limited: slow down')).toBe('rate-limited')
    expect(reasonPrefix('duplicate:')).toBe('duplicate')
  })
  test('returns undefined for no/unknown prefix', () => {
    expect(reasonPrefix('just a message')).toBeUndefined()
    expect(reasonPrefix('weird: thing')).toBeUndefined()
  })
})

test('serializeClientMessage', () => {
  expect(serializeClientMessage(['CLOSE', 'sub'])).toBe('["CLOSE","sub"]')
})
