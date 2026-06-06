'use client'
// A live island: streams real kind-1 notes from public relays, in the browser,
// using the actual published @hopstr/pool. Defensive by design — multi-relay,
// a timeout, connection-state UI — so it never blocks render or hangs the page.
import { useEffect, useState } from 'react'
import { Pool } from '@hopstr/pool'

const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

interface Note {
  id: string
  author: string
  content: string
  created_at: number
}

export function LiveFeed({ relays = DEFAULT_RELAYS, limit = 8 }: { relays?: string[]; limit?: number }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'idle'>('connecting')

  useEffect(() => {
    const pool = new Pool()
    const seen = new Set<string>()
    const controller = new AbortController()
    let alive = true

    const timer = setTimeout(() => {
      if (alive && notes.length === 0) setStatus('idle')
    }, 8000)

    ;(async () => {
      try {
        for await (const e of pool.subscribe(relays, [{ kinds: [1], limit }], { signal: controller.signal })) {
          if (!alive || seen.has(e.id)) continue
          seen.add(e.id)
          setStatus('live')
          setNotes((prev) => [{ id: e.id, author: e.pubkey, content: e.content, created_at: e.created_at }, ...prev].slice(0, limit))
        }
      } catch {
        if (alive) setStatus('idle')
      }
    })()

    return () => {
      alive = false
      clearTimeout(timer)
      controller.abort()
      pool.close()
    }
  }, [relays.join(','), limit])

  return (
    <div style={box}>
      <div style={header}>
        <span style={dot(status)} /> {status === 'live' ? 'Live from Nostr' : status === 'connecting' ? 'Connecting…' : 'Quiet right now'}
      </div>
      {notes.length === 0 && status !== 'idle' && <div style={{ opacity: 0.6, padding: '8px 0' }}>waiting for notes…</div>}
      {notes.map((n) => (
        <div key={n.id} style={card}>
          <div style={{ fontSize: 12, opacity: 0.6 }}>{n.author.slice(0, 12)}…</div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{n.content.slice(0, 280)}</div>
        </div>
      ))}
    </div>
  )
}

const box: React.CSSProperties = { border: '1px solid var(--vocs-color_border)', borderRadius: 12, padding: 16, maxHeight: 420, overflow: 'auto' }
const header: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginBottom: 12 }
const card: React.CSSProperties = { padding: '10px 0', borderTop: '1px solid var(--vocs-color_border)' }
const dot = (s: string): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: s === 'live' ? '#22c55e' : s === 'connecting' ? '#eab308' : '#94a3b8',
  display: 'inline-block',
})
