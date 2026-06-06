import { describe, test, expect } from 'bun:test'
import { parseSince } from '../src/since.ts'

const now = Math.floor(Date.now() / 1000)
const EPSILON = 2 // allow 2s drift for test execution time

function approx(a: number, b: number, delta = EPSILON) {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(delta)
}

describe('parseSince — relative', () => {
  test('1h', () => approx(parseSince('1h'), now - 3600))
  test('2h', () => approx(parseSince('2h'), now - 7200))
  test('30m', () => approx(parseSince('30m'), now - 1800))
  test('1d', () => approx(parseSince('1d'), now - 86400))
  test('2d', () => approx(parseSince('2d'), now - 172800))
  test('1w', () => approx(parseSince('1w'), now - 604800))
  test('1h ago', () => approx(parseSince('1h ago'), now - 3600))
  test('2d ago', () => approx(parseSince('2d ago'), now - 172800))
  test('30m ago', () => approx(parseSince('30m ago'), now - 1800))
  test('1 hour', () => approx(parseSince('1 hour'), now - 3600))
  test('2 days', () => approx(parseSince('2 days'), now - 172800))
  test('1 week', () => approx(parseSince('1 week'), now - 604800))
})

describe('parseSince — ISO 8601', () => {
  test('date only', () => {
    const ts = parseSince('2025-01-01')
    expect(ts).toBe(Math.floor(Date.parse('2025-01-01') / 1000))
  })
  test('datetime', () => {
    const ts = parseSince('2025-06-01T00:00:00')
    expect(ts).toBe(Math.floor(Date.parse('2025-06-01T00:00:00') / 1000))
  })
})

describe('parseSince — natural language', () => {
  test('now', () => approx(parseSince('now'), now))
  test('today', () => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    expect(parseSince('today')).toBe(Math.floor(d.getTime() / 1000))
  })
  test('yesterday', () => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    expect(parseSince('yesterday')).toBe(Math.floor(d.getTime() / 1000) - 86400)
  })
  test('last week', () => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    expect(parseSince('last week')).toBe(Math.floor(d.getTime() / 1000) - 7 * 86400)
  })
  test('last month', () => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0)
    expect(parseSince('last month')).toBe(Math.floor(d.getTime() / 1000))
  })
})

describe('parseSince — unix timestamp', () => {
  test('raw number string', () => {
    expect(parseSince('1749200000')).toBe(1749200000)
  })
})

describe('parseSince — errors', () => {
  test('throws on unrecognized input', () => {
    expect(() => parseSince('blah')).toThrow('unrecognized --since value')
  })
  test('throws on empty string', () => {
    expect(() => parseSince('')).toThrow()
  })
})
