// NIP-11 relay information document, with an injected fetch.
import { describe, expect, test } from 'bun:test'
import { clampLimit, fetchRelayInformation, infoUrl, supportsNip } from '../src/nip11.ts'

describe('nip11', () => {
  test('infoUrl converts ws(s) to http(s)', () => {
    expect(infoUrl('wss://relay.example')).toBe('https://relay.example')
    expect(infoUrl('ws://localhost:7777')).toBe('http://localhost:7777')
  })

  test('fetchRelayInformation sends the nostr+json Accept header', async () => {
    let sawHeader = ''
    const fakeFetch = (async (_url: string, init?: { headers?: Record<string, string> }) => {
      sawHeader = init?.headers?.Accept ?? ''
      return { ok: true, json: async () => ({ name: 'Test', supported_nips: [1, 42], limitation: { max_limit: 500 } }) }
    }) as unknown as typeof fetch
    const info = await fetchRelayInformation('wss://relay.example', fakeFetch)
    expect(sawHeader).toBe('application/nostr+json')
    expect(info.name).toBe('Test')
    expect(supportsNip(info, 42)).toBe(true)
    expect(supportsNip(info, 99)).toBe(false)
    expect(clampLimit(info, 1000)).toBe(500)
    expect(clampLimit(info, 100)).toBe(100)
  })

  test('clampLimit / supportsNip handle missing fields', () => {
    expect(clampLimit({}, 1000)).toBe(1000)
    expect(supportsNip({}, 1)).toBe(false)
  })

  test('throws on a non-OK response', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
    await expect(fetchRelayInformation('wss://x', fakeFetch)).rejects.toThrow('404')
  })
})
