'use client'
// The marquee island: generates a CLEARLY-LABELED EPHEMERAL throwaway key, signs a
// note with the real @hopstr/client, and publishes it to a test relay — all in
// the reader's browser. The demo IS the pitch: "it actually works, watch."
import { useState } from 'react'
import { Nostr } from '@hopstr/client'

// A throwaway relay good for demos. Never a real identity — a fresh key each run.
const TEST_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol']

type Result = { ok: boolean; relay: string; reason: string }

export function HelloNostr() {
  const [text, setText] = useState('gm from the Velvet docs 👋')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[] | null>(null)
  const [npub, setNpub] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function publish() {
    setBusy(true)
    setError(null)
    setResults(null)
    try {
      // A brand-new random identity, just for this click. Disposable on purpose.
      const nostr = await Nostr.create({ relays: TEST_RELAYS, outbox: false })
      setNpub((await nostr.pubkey()).slice(0, 16) + '…')
      const published = await Promise.race([
        nostr.note(text),
        new Promise<Result[]>((_, reject) => setTimeout(() => reject(new Error('timed out')), 10_000)),
      ])
      setResults(published as Result[])
      nostr.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Post to Nostr, right now, from this page</div>
      <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 12 }}>
        Generates a fresh throwaway key in your browser and publishes a real note. Nothing is saved.
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} style={textarea} disabled={busy} />
      <button onClick={publish} disabled={busy || text.trim().length === 0} style={button}>
        {busy ? 'Signing & publishing…' : 'Publish ✦'}
      </button>
      {npub && <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>ephemeral npub: {npub}</div>}
      {results && (
        <ul style={{ marginTop: 8, fontSize: 13 }}>
          {results.map((r) => (
            <li key={r.relay} style={{ color: r.ok ? '#22c55e' : '#ef4444' }}>
              {r.ok ? '✓' : '✕'} {r.relay} {r.reason && `— ${r.reason}`}
            </li>
          ))}
        </ul>
      )}
      {error && <div style={{ marginTop: 8, color: '#ef4444', fontSize: 13 }}>error: {error}</div>}
    </div>
  )
}

const box: React.CSSProperties = { border: '1px solid var(--vocs-color_border)', borderRadius: 12, padding: 16 }
const textarea: React.CSSProperties = { width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--vocs-color_border)', background: 'transparent', color: 'inherit', resize: 'vertical' }
const button: React.CSSProperties = { marginTop: 8, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#7c5cff', color: 'white', fontWeight: 600, cursor: 'pointer' }
