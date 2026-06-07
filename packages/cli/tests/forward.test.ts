import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolvePreset, makeForwarder, PRESETS, type SpawnLike } from '../src/forward.ts'

// A fake SpawnLike that records every call's argv + stdin writes, and hands back a
// manually-resolvable `exited` so we can observe concurrency overlap. No real processes.
type SpawnOpts = { stdin: 'pipe' | 'ignore'; stdout: 'ignore'; stderr: 'inherit' }
interface Call { argv: string[]; opts: SpawnOpts; writes: string[]; ended: boolean; resolve: (code: number) => void }

function fakeSpawn(): { spawn: SpawnLike; calls: Call[]; throwOnce: () => void } {
  const calls: Call[] = []
  let throwNext = false
  const spawn: SpawnLike = (argv, opts) => {
    if (throwNext) { throwNext = false; throw new Error('spawn ENOENT') }
    const writes: string[] = []
    let resolve!: (code: number) => void
    const exited = new Promise<number>((r) => { resolve = r })
    const call: Call = { argv, opts, writes, ended: false, resolve }
    calls.push(call)
    return {
      stdin: { write: (s) => { writes.push(s) }, end: () => { call.ended = true } },
      exited,
    }
  }
  return { spawn, calls, throwOnce: () => { throwNext = true } }
}

describe('resolvePreset', () => {
  test('known preset → stdin claude', () => {
    const p = resolvePreset('claude')
    expect(p.bin).toBe('claude')
    expect(p.promptMode).toBe('stdin')
    expect(p.args).toContain('-p')
  })

  test('known preset → arg codex carries {}', () => {
    const p = resolvePreset('codex')
    expect(p.bin).toBe('codex')
    expect(p.promptMode).toBe('arg')
    expect(p.args).toContain('{}')
  })

  test('--exec with {} → arg mode', () => {
    const p = resolvePreset(undefined, 'mytool run {}')
    expect(p).toEqual({ bin: 'mytool', args: ['run', '{}'], promptMode: 'arg' })
  })

  test('--exec without {} → stdin mode', () => {
    const p = resolvePreset(undefined, 'mytool --headless')
    expect(p).toEqual({ bin: 'mytool', args: ['--headless'], promptMode: 'stdin' })
  })

  test('both --agent and --exec → throws', () => {
    expect(() => resolvePreset('claude', 'mytool')).toThrow(/not both/)
  })

  test('unknown agent → throws with preset list', () => {
    expect(() => resolvePreset('nope')).toThrow(/unknown agent/)
  })

  test('empty --exec → throws (whitespace or empty string, present but blank)', () => {
    expect(() => resolvePreset(undefined, '   ')).toThrow(/needs a command/)
    expect(() => resolvePreset(undefined, '')).toThrow(/needs a command/)
  })

  test('preset spot-checks', () => {
    expect(resolvePreset('aider').args).toEqual(['--yes-always', '--message', '{}'])
    expect(resolvePreset('opencode').args).toEqual(['run', '{}'])
    expect(resolvePreset('gemini').promptMode).toBe('stdin')
    expect(resolvePreset('amp').promptMode).toBe('stdin')
    // every preset is internally consistent: arg-mode iff it carries a {}
    for (const p of Object.values(PRESETS)) {
      expect(p.args.includes('{}')).toBe(p.promptMode === 'arg')
    }
  })
})

describe('makeForwarder — spawn shape', () => {
  let errs: string[]
  const origErr = console.error
  beforeEach(() => { errs = []; console.error = (...a: unknown[]) => errs.push(a.join(' ')) })
  afterEach(() => { console.error = origErr })

  test('arg mode: {} replaced, stdin ignored, never writes', async () => {
    const { spawn, calls } = fakeSpawn()
    const f = makeForwarder(resolvePreset('codex'), 4, spawn)
    f.forward('fix the bug')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.argv).toEqual(['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', 'fix the bug'])
    expect(calls[0]!.opts.stdin).toBe('ignore')
    expect(calls[0]!.writes).toHaveLength(0)
    calls[0]!.resolve(0)
    await f.drain()
  })

  test('stdin mode: no prompt in argv, text piped + ended', async () => {
    const { spawn, calls } = fakeSpawn()
    const f = makeForwarder(resolvePreset('claude'), 4, spawn)
    f.forward('hello there')
    expect(calls[0]!.argv).toEqual(['claude', '-p', '--permission-mode', 'acceptEdits'])
    expect(calls[0]!.argv).not.toContain('hello there')
    expect(calls[0]!.opts.stdin).toBe('pipe')
    expect(calls[0]!.writes).toEqual(['hello there'])
    expect(calls[0]!.ended).toBe(true)
    calls[0]!.resolve(0)
    await f.drain()
  })

  test('stderr is inherited (the deadlock fix)', () => {
    const { spawn, calls } = fakeSpawn()
    makeForwarder(resolvePreset('amp'), 4, spawn).forward('hi')
    expect(calls[0]!.opts.stderr).toBe('inherit')
    expect(calls[0]!.opts.stdout).toBe('ignore')
  })

  test('--exec mid-arg + multiple {} all substituted', async () => {
    const { spawn, calls } = fakeSpawn()
    const f = makeForwarder(resolvePreset(undefined, 'tool --flag {} --tail {}'), 4, spawn)
    f.forward('X')
    expect(calls[0]!.argv).toEqual(['tool', '--flag', 'X', '--tail', 'X'])
    calls[0]!.resolve(0)
    await f.drain()
  })
})

describe('makeForwarder — concurrency cap', () => {
  test('never exceeds the cap; queue drains in order', async () => {
    const { spawn, calls } = fakeSpawn()
    const f = makeForwarder(resolvePreset('codex'), 2, spawn)
    for (const t of ['a', 'b', 'c', 'd', 'e']) f.forward(t)

    // only 2 in flight while none have exited
    expect(calls).toHaveLength(2)
    const text = (c: Call) => c.argv[c.argv.length - 1]
    expect(calls.map(text)).toEqual(['a', 'b'])

    calls[0]!.resolve(0)       // free one slot
    await Promise.resolve()    // let .finally → pump() run
    await Promise.resolve()
    expect(calls).toHaveLength(3)
    expect(text(calls[2]!)).toBe('c')

    for (const c of calls) c.resolve(0)
    // resolve the rest as they spawn, then drain
    await tick()
    for (const c of calls) c.resolve(0)
    await f.drain()
    expect(calls).toHaveLength(5)
    expect(calls.map(text)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('makeForwarder — failures', () => {
  let errs: string[]
  const origErr = console.error
  beforeEach(() => { errs = []; console.error = (...a: unknown[]) => errs.push(a.join(' ')) })
  afterEach(() => { console.error = origErr })

  test('spawn throw (ENOENT): forward never throws, slot freed, drain resolves', async () => {
    const { spawn, calls, throwOnce } = fakeSpawn()
    const f = makeForwarder(resolvePreset('claude'), 1, spawn)
    throwOnce()
    expect(() => f.forward('first')).not.toThrow()
    await tick()
    expect(errs.some((e) => /failed to spawn claude/.test(e))).toBe(true)
    // slot was freed → a subsequent forward still spawns
    f.forward('second')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.writes).toEqual(['second'])
    calls[0]!.resolve(0)
    await f.drain()
  })

  test('non-zero exit is logged', async () => {
    const { spawn, calls } = fakeSpawn()
    const f = makeForwarder(resolvePreset('codex'), 4, spawn)
    f.forward('boom')
    calls[0]!.resolve(2)
    await f.drain()
    expect(errs.some((e) => /\[forward\] codex exited 2/.test(e))).toBe(true)
  })
})

// Mirrors the listen.ts emit wrapper so we can assert the dm/mention/reply filter
// without a live relay. Keep this in lockstep with listen.ts.
describe('listen forward filter', () => {
  function wrapper(forward: (t: string) => void) {
    return (ev: { type: string; content?: string; text?: string }) => {
      if (ev.type !== 'reaction') {
        const text = ev.content ?? ev.text
        if (text) forward(text)
      }
    }
  }

  test('mention/reply use content, dm uses text, reaction skipped, empty skipped', () => {
    const sent: string[] = []
    const emit = wrapper((t) => sent.push(t))
    emit({ type: 'mention', content: 'm' })
    emit({ type: 'reply', content: 'r' })
    emit({ type: 'dm', text: 'd' })
    emit({ type: 'reaction', emoji: '🔥' } as { type: string })
    emit({ type: 'mention', content: '' })
    expect(sent).toEqual(['m', 'r', 'd'])
  })
})

// Yield enough microtask turns for pump()/finally chains to settle.
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
