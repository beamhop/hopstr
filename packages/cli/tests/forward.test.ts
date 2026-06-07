import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolvePreset, makeForwarder, showOutput, PRESETS, type SpawnLike } from '../src/forward.ts'
import { buildPrompt } from '../src/prompt.ts'
import type { FormattedEvent } from '../src/format.ts'

const NPUB = 'npub1mn02zpkexampleexampleexampleexampleexampleexampleexampleex'
const ID = 'a'.repeat(64)

// A fake SpawnLike that records every call's argv + stdin writes, and hands back a
// manually-resolvable `exited` so we can observe concurrency overlap. No real processes.
type SpawnOpts = { stdin: 'pipe' | 'ignore'; stdout: 'pipe'; stderr: 'inherit' }
interface Call { argv: string[]; opts: SpawnOpts; writes: string[]; ended: boolean; done: boolean; resolve: (code: number) => void }

// A ReadableStream emitting the given text as one chunk then closing (the agent's stdout).
function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      if (text) c.enqueue(new TextEncoder().encode(text))
      c.close()
    },
  })
}

function fakeSpawn(stdoutText = ''): { spawn: SpawnLike; calls: Call[]; throwOnce: () => void } {
  const calls: Call[] = []
  let throwNext = false
  const spawn: SpawnLike = (argv, opts) => {
    if (throwNext) { throwNext = false; throw new Error('spawn ENOENT') }
    const writes: string[] = []
    let resolve!: (code: number) => void
    const exited = new Promise<number>((r) => { resolve = r })
    const call: Call = { argv, opts, writes, ended: false, done: false, resolve: (c) => resolve(c) }
    void exited.then(() => { call.done = true })
    calls.push(call)
    return {
      stdin: { write: (s) => { writes.push(s) }, end: () => { call.ended = true } },
      stdout: streamOf(stdoutText),
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
    // copilot/gemini take the prompt as the value of -p, so they MUST be arg-mode
    // with {} (a stdin preset would let -p swallow the next flag as its prompt).
    expect(resolvePreset('copilot').args).toEqual(['--allow-all-tools', '--no-ask-user', '-p', '{}'])
    expect(resolvePreset('gemini').args).toEqual(['--yolo', '-p', '{}'])
    expect(resolvePreset('claude').promptMode).toBe('stdin')
    expect(resolvePreset('amp').promptMode).toBe('stdin')
    // every preset is internally consistent: arg-mode iff it carries a {}
    for (const p of Object.values(PRESETS)) {
      expect(p.args.includes('{}')).toBe(p.promptMode === 'arg')
    }
  })

  // Regression guard for the copilot/gemini bug: their `-p` TAKES the prompt as its
  // value, so in stdin mode the bare `-p` swallowed the next flag as the prompt and the
  // piped DM text was dropped. They must be arg-mode and the `-p` must be immediately
  // followed by the `{}` placeholder (not by another flag).
  test('value-taking -p presets put {} right after -p (copilot/gemini regression)', () => {
    for (const name of ['copilot', 'gemini']) {
      const p = resolvePreset(name)
      expect(p.promptMode).toBe('arg')
      const i = p.args.indexOf('-p')
      expect(i, `${name} must pass the prompt via -p`).toBeGreaterThanOrEqual(0)
      expect(p.args[i + 1], `${name}'s -p must be immediately followed by {}`).toBe('{}')
    }
  })

  // claude's -p is the boolean --print flag (NOT a value-taking prompt flag): it reads
  // the prompt from stdin, so it is correctly a stdin preset with no {}.
  test('claude -p is boolean print mode (stdin, no placeholder)', () => {
    const p = resolvePreset('claude')
    expect(p.promptMode).toBe('stdin')
    expect(p.args).not.toContain('{}')
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

  test('stderr inherited, stdout piped (drained to our stderr, not discarded)', () => {
    const { spawn, calls } = fakeSpawn()
    makeForwarder(resolvePreset('amp'), 4, spawn).forward('hi')
    expect(calls[0]!.opts.stderr).toBe('inherit')
    expect(calls[0]!.opts.stdout).toBe('pipe')
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
    const text = (c: Call) => c.argv[c.argv.length - 1]

    // only 2 in flight while none have exited
    expect(calls).toHaveLength(2)
    expect(calls.map(text)).toEqual(['a', 'b'])

    // freeing one slot pumps exactly the next queued item (c). A run frees its slot
    // only after BOTH exit and stdout-drain settle, so poll rather than count ticks.
    calls[0]!.resolve(0)
    await waitFor(() => calls.length === 3)
    expect(text(calls[2]!)).toBe('c')

    // resolve everything that has spawned, repeatedly, until all 5 have run.
    while (calls.length < 5 || calls.some((c) => !c.done)) {
      for (const c of calls) c.resolve(0)
      await tick()
    }
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

describe('agent output → stderr', () => {
  let errs: string[]
  const origErr = console.error
  beforeEach(() => { errs = []; console.error = (...a: unknown[]) => errs.push(a.join(' ')) })
  afterEach(() => { console.error = origErr })

  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({ start(c) { if (text) c.enqueue(new TextEncoder().encode(text)); c.close() } })
  }

  test('showOutput prints each line prefixed with [bin]', async () => {
    await showOutput(streamOf('line one\nline two\n'), 'claude')
    expect(errs).toEqual(['[claude] line one', '[claude] line two'])
  })

  test('showOutput emits a trailing line that has no newline', async () => {
    await showOutput(streamOf('no trailing newline'), 'codex')
    expect(errs).toEqual(['[codex] no trailing newline'])
  })

  test('showOutput skips blank lines and empty output', async () => {
    await showOutput(streamOf('\n\nhi\n\n'), 'amp')
    expect(errs).toEqual(['[amp] hi'])
    errs.length = 0
    await showOutput(streamOf(''), 'amp')
    expect(errs).toEqual([])
  })

  test('showOutput swallows a torn stream', async () => {
    const torn = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error('boom')) } })
    await showOutput(torn, 'gemini') // must not reject
    expect(errs).toEqual([])
  })

  test('makeForwarder streams the agent reply to stderr', async () => {
    const { spawn, calls } = fakeSpawn('Hi there!\n')
    const f = makeForwarder(resolvePreset('claude'), 4, spawn)
    f.forward('hello')
    calls[0]!.resolve(0)
    await f.drain()
    expect(errs).toContain('[claude] Hi there!')
  })
})

// Mirrors the listen.ts emit wrapper so we can assert the dm/mention/reply filter
// without a live relay. Keep this in lockstep with listen.ts.
describe('listen forward filter', () => {
  function wrapper(forward: (t: string) => void) {
    return (ev: FormattedEvent) => {
      if (ev.type !== 'reaction') forward(buildPrompt(ev))
    }
  }

  test('dm/mention/reply forward (with the message embedded); reaction does not', () => {
    const sent: string[] = []
    const emit = wrapper((t) => sent.push(t))
    emit({ type: 'mention', from: NPUB, id: ID, content: 'm', at: 1 })
    emit({ type: 'reply', from: NPUB, id: ID, content: 'r', at: 1 })
    emit({ type: 'dm', from: NPUB, text: 'd', at: 1, dmKind: 'nip17' })
    emit({ type: 'reaction', from: NPUB, emoji: '🔥', at: 1 })
    expect(sent).toHaveLength(3)
    expect(sent[0]).toContain('m')
    expect(sent[1]).toContain('r')
    expect(sent[2]).toContain('d')
  })
})

// Yield enough microtask turns for pump()/finally chains to settle.
async function tick(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

// Poll a predicate across microtask turns until true (or give up after a bound).
async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !cond(); i++) await Promise.resolve()
}
