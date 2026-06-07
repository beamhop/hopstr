// Forward incoming events to a coding-agent CLI. `hopstr listen --agent claude`
// (or any of the presets below) spawns the agent with the event's text and walks
// away — fire-and-forget. We never read the agent's output; our job ends at spawn.
export type PromptMode = 'stdin' | 'arg'
export interface Preset { bin: string; args: string[]; promptMode: PromptMode }

// `{}` is the placeholder replaced by the raw event text (promptMode 'arg'); a `{}`
// anywhere in args means arg-mode, its absence means the text is piped to stdin.
//
// The auto-approve / headless flags are baked in deliberately: a forwarded run has
// no TTY, so any tool-permission prompt would block forever on a piped stdin and
// wedge a concurrency slot — the #1 footgun. Choosing `listen --agent` *is* opting
// into automation; anyone wanting tighter control uses `--exec` with their own flags.
// `claude` gets the milder `acceptEdits` (not `bypassPermissions`) since the text
// comes from strangers on Nostr. stdin presets also dodge ARG_MAX on long DMs.
// IMPORTANT: a tool whose prompt flag *takes a value* (copilot/gemini/cursor/aider `-p`/
// `--message <text>`) must be `arg` mode with `{}` — NOT `stdin`. In stdin mode the bare
// flag swallows the next arg as its prompt (e.g. `copilot -p --allow-all-tools` runs the
// literal "--allow-all-tools" as the prompt) and the piped text is ignored. Only tools
// that genuinely read the prompt from stdin (claude -p, codex exec, amp -x) use `stdin`.
// Verified against the installed claude/codex/gemini/copilot/opencode CLIs.
export const PRESETS: Record<string, Preset> = {
  claude:   { bin: 'claude',       args: ['-p', '--permission-mode', 'acceptEdits'],                   promptMode: 'stdin' },
  codex:    { bin: 'codex',        args: ['exec', '--dangerously-bypass-approvals-and-sandbox', '{}'], promptMode: 'arg' },
  gemini:   { bin: 'gemini',       args: ['--yolo', '-p', '{}'],                                       promptMode: 'arg' },
  copilot:  { bin: 'copilot',      args: ['--allow-all-tools', '--no-ask-user', '-p', '{}'],           promptMode: 'arg' },
  aider:    { bin: 'aider',        args: ['--yes-always', '--message', '{}'],                          promptMode: 'arg' },
  cursor:   { bin: 'cursor-agent', args: ['-p', '{}', '--force'],                                      promptMode: 'arg' },
  amp:      { bin: 'amp',          args: ['-x'],                                                       promptMode: 'stdin' },
  opencode: { bin: 'opencode',     args: ['run', '{}'],                                                promptMode: 'arg' },
}

/** Resolve --agent/--exec flags into a Preset. Throws on conflicting/invalid input. */
export function resolvePreset(agent?: string, exec?: string): Preset {
  if (agent !== undefined && exec !== undefined) throw new Error('use --agent OR --exec, not both')
  if (exec !== undefined) {
    // Tokenize on whitespace — no shell is invoked, so there's no injection surface.
    const tokens = exec.trim().split(/\s+/).filter(Boolean)
    if (!tokens.length) throw new Error('--exec needs a command')
    const [bin, ...args] = tokens
    return { bin: bin!, args, promptMode: args.includes('{}') ? 'arg' : 'stdin' }
  }
  const p = agent ? PRESETS[agent] : undefined
  if (!p) throw new Error(`unknown agent "${agent}". presets: ${Object.keys(PRESETS).join(', ')}`)
  return p
}

// The minimal Bun.spawn surface we depend on, so tests inject a fake (no real
// processes). stderr is 'inherit' (not 'pipe'): a piped stderr is only drained on
// non-zero exit, so a chatty agent that exits 0 would fill the pipe buffer, block,
// and permanently wedge a slot. Inheriting lets agent stderr flow to ours instead.
export interface SpawnLike {
  (cmd: string[], opts: { stdin: 'pipe' | 'ignore'; stdout: 'ignore'; stderr: 'inherit' }): {
    stdin: { write(s: string): void; end(): void } | null
    exited: Promise<number>
  }
}

export interface Forwarder {
  forward(text: string): void   // fire-and-forget; never throws
  drain(): Promise<void>        // await all in-flight (SIGINT / tests)
}

export function makeForwarder(
  preset: Preset,
  maxConcurrency = 4,
  spawn: SpawnLike = Bun.spawn as unknown as SpawnLike,
): Forwarder {
  let active = 0
  const queue: string[] = []
  const inflight = new Set<Promise<void>>()

  // A freed slot pulls exactly one queued item, so peak never exceeds the cap.
  function pump(): void {
    while (active < maxConcurrency && queue.length) {
      const text = queue.shift()!
      active++
      const p = run(text).finally(() => { active--; inflight.delete(p); pump() })
      inflight.add(p)
    }
  }

  async function run(text: string): Promise<void> {
    const argv = preset.promptMode === 'arg'
      ? [preset.bin, ...preset.args.map((a) => (a === '{}' ? text : a))]
      : [preset.bin, ...preset.args]
    try {
      const proc = spawn(argv, {
        stdin: preset.promptMode === 'stdin' ? 'pipe' : 'ignore',
        stdout: 'ignore',
        stderr: 'inherit',
      })
      if (preset.promptMode === 'stdin' && proc.stdin) {
        proc.stdin.write(text)
        proc.stdin.end()
      }
      const code = await proc.exited
      if (code !== 0) console.error(`[forward] ${preset.bin} exited ${code}`)
    } catch (e) {
      console.error(`[forward] failed to spawn ${preset.bin}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    forward(text) { queue.push(text); pump() },
    async drain() { while (inflight.size) await Promise.race(inflight) },
  }
}
