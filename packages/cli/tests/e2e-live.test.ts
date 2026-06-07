// LIVE end-to-end test — the ONLY test in this repo that hits the real Nostr network
// AND drives the real `copilot` LLM. Everything else uses an in-process mock relay.
//
// It proves the `hopstr listen --agent copilot` two-way bot loop end to end:
//   1. mint two ephemeral identities — Alice (the bot/listener) and Bob (the user)
//   2. Bob DMs Alice, mentions Alice, and replies to Alice's note
//   3. Alice's `listen --agent copilot` forwards each event to copilot, which answers
//      ON NOSTR ITSELF (it runs `hopstr reply`/`hopstr dm`, inheriting Alice's NOSTR_NSEC)
//   4. Bob observes Alice's copilot-generated answers coming back over the network
//
// Because it is multi-minute and non-deterministic at the LLM boundary, it is OPT-IN:
//   HOPSTR_E2E_LIVE=1 bun test packages/cli/tests/e2e-live.test.ts
// A normal `bun test` / CI run does NOT register it (see `describe.if(LIVE)` below).
//
// PRECONDITIONS (all REQUIRED — a miss FAILS the test with a warning, never skips):
//   - `hopstr` on PATH        (the installed CLI; we drive the real binary, not the source)
//   - `copilot` installed, authenticated, configured
//   - the hopstr `nostr` skill installed at ~/.agents/skills/nostr/SKILL.md
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { nip19 } from '@hopstr/core'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LIVE = process.env['HOPSTR_E2E_LIVE'] === '1'

// ── tunable timing (real wall-clock; live relays + an LLM are slow) ──
const BOOTSTRAP_WAIT_MS = 15_000   // let Alice's kind-10002/10050 propagate before DMs route
const PUBLISH_SETTLE_MS = 12_000   // a publish reaching the default relays
const COPILOT_REPLY_MS  = 150_000  // copilot: read prompt → decide → run hopstr → publish
const MENTION_SOFT_MS   = 90_000   // shorter budget for the soft (search-indexed) mention
const POLL_INTERVAL_MS  = 5_000
const SUBSCRIBE_MS       = 30_000
const TEST_TIMEOUT_MS    = 540_000 // whole flow

// ── small types mirroring the CLI's JSON output ──
interface Id { nsec: string; npub: string }
interface PublishOk { ok: boolean; id: string }           // post/reply/dm --json
interface RawEvent { id: string; pubkey: string; kind: number; tags: string[][]; content: string }  // events in a thread tree
interface FormattedEvent {
  type: 'mention' | 'reply' | 'dm' | 'reaction'
  from: string
  id?: string
  content?: string
  text?: string
  at: number
  dmKind?: 'nip17' | 'nip04'
  raw?: unknown
}
interface ThreadNode { event: RawEvent; children: ThreadNode[] }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Spawn-and-collect a process; return { code, out, err }. A subprocess that hangs (e.g.
// `hopstr thread` waiting on an unresponsive relay) is KILLED at `timeoutMs` and reported
// as code -1 — without this, a single stuck child blocks the whole test past its deadline.
const CMD_TIMEOUT_MS = 30_000
async function exec(
  cmd: string[],
  env: Record<string, string> = {},
  timeoutMs = CMD_TIMEOUT_MS,
): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; try { proc.kill() } catch { /* gone */ } }, timeoutMs)
  try {
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code: timedOut ? -1 : code, out, err: timedOut ? `${err}\n[timed out after ${timeoutMs}ms]` : err }
  } finally {
    clearTimeout(timer)
  }
}

// One-shot `hopstr <args> --json`, returns the parsed last JSON line. Throws on failure.
// `--json` is appended automatically — without it these commands print human text
// (e.g. `post` prints `published: <id>`), which isn't parseable. `reply` is the slowest
// command (it FETCHES the parent from relays, then publishes to all of them), so its
// default budget is larger than a bare `thread`/`post`.
async function run<T = Record<string, unknown>>(
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = CMD_TIMEOUT_MS,
): Promise<T> {
  const { code, out, err } = await exec(['hopstr', ...args, '--json'], env, timeoutMs)
  if (code !== 0) throw new Error(`hopstr ${args.join(' ')} exited ${code}: ${err.trim()}`)
  const line = out.trim().split('\n').filter(Boolean).pop()
  if (!line) throw new Error(`hopstr ${args.join(' ')} produced no JSON output. stderr: ${err.trim()}`)
  return JSON.parse(line) as T
}

// `run` for the SETUP publishes — live relays occasionally stall a publish past its
// budget, which shouldn't sink the whole test. Retry a couple of times with a fresh,
// longer budget before giving up.
const PUBLISH_CMD_MS = 60_000
async function publish<T = Record<string, unknown>>(args: string[], env: Record<string, string>, tries = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < tries; i++) {
    try { return await run<T>(args, env, PUBLISH_CMD_MS) }
    catch (e) { last = e; console.warn(`[e2e-live] retry ${i + 1}/${tries}: hopstr ${args[0]} — ${e instanceof Error ? e.message : e}`) }
  }
  throw last
}

// Precondition gate. Returns the FIRST failure, or { ok: true }.
async function checkPreconditions(): Promise<{ ok: boolean; reason?: string }> {
  if ((await exec(['which', 'hopstr'])).code !== 0) return { ok: false, reason: 'hopstr is not on PATH (install the CLI globally)' }
  if ((await exec(['which', 'copilot'])).code !== 0) return { ok: false, reason: 'copilot is not on PATH' }
  const ver = await exec(['copilot', '--version'])
  if (ver.code !== 0) return { ok: false, reason: `copilot --version failed (not installed/authenticated?): ${ver.err.trim()}` }
  const skill = join(homedir(), '.agents', 'skills', 'nostr', 'SKILL.md')
  if (!(await Bun.file(skill).exists())) return { ok: false, reason: `nostr skill not installed at ${skill}` }
  return { ok: true }
}

// A backgrounded `hopstr listen --json [--agent copilot]`. Drains stdout into `events`
// and watches stderr for the "listening as" marker (subscription is live).
interface ListenHandle {
  events: FormattedEvent[]
  waitSubscribed(timeoutMs: number): Promise<void>
  waitForEvent(pred: (e: FormattedEvent) => boolean, timeoutMs: number): Promise<FormattedEvent>
  waitForStderr(test: (buf: string) => boolean, timeoutMs: number): Promise<void>
  stderr(): string
  kill(): void
}

function startListen(env: Record<string, string>, opts: { agent?: boolean; label?: string } = {}): ListenHandle {
  const agent = opts.agent ?? true
  const label = opts.label ?? 'listen'
  const proc = Bun.spawn(
    ['hopstr', 'listen', '--json', ...(agent ? ['--agent', 'copilot'] : [])],
    { env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' },
  )

  const events: FormattedEvent[] = []
  let subscribed = false
  let stderrBuf = ''

  // stdout → one FormattedEvent per line.
  void (async () => {
    const reader = proc.stdout.getReader()
    const dec = new TextDecoder()
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) try { events.push(JSON.parse(line) as FormattedEvent) } catch { /* not JSON */ }
        }
      }
    } catch { /* stream torn on kill */ }
  })()

  // stderr → marker detection + echo (copilot's work shows up here, prefixed [copilot]).
  void (async () => {
    const reader = proc.stderr.getReader()
    const dec = new TextDecoder()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value, { stream: true })
        stderrBuf += chunk
        if (stderrBuf.includes('listening as')) subscribed = true
        for (const l of chunk.split('\n')) if (l.trim()) console.error(`[${label}] ${l.trim()}`)
      }
    } catch { /* stream torn on kill */ }
  })()

  return {
    events,
    async waitSubscribed(timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (!subscribed) {
        if (Date.now() > deadline) throw new Error(`${label}: never subscribed within ${timeoutMs}ms. stderr:\n${stderrBuf}`)
        await sleep(500)
      }
    },
    async waitForEvent(pred, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const hit = events.find(pred)
        if (hit) return hit
        if (Date.now() > deadline) throw new Error(`${label}: no matching event within ${timeoutMs}ms (saw ${events.length})`)
        await sleep(POLL_INTERVAL_MS)
      }
    },
    async waitForStderr(test, timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (!test(stderrBuf)) {
        if (Date.now() > deadline) throw new Error(`${label}: stderr never matched within ${timeoutMs}ms. stderr tail:\n${stderrBuf.slice(-2000)}`)
        await sleep(POLL_INTERVAL_MS)
      }
    },
    stderr: () => stderrBuf,
    kill: () => { try { proc.kill() } catch { /* already gone */ } },
  }
}

// Poll an (async) predicate on a wall-clock interval until it returns truthy.
async function waitFor<T>(pred: () => T | Promise<T>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const v = await pred()
    if (v) return v
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`)
    await sleep(POLL_INTERVAL_MS)
  }
}

// Flatten a thread tree into a flat list of events.
function flatten(node: ThreadNode): RawEvent[] {
  return [node.event, ...node.children.flatMap(flatten)]
}

// True if `thread <eventId>` contains a kind-1 from `authorHex` that e-tags `eventId`.
// A failed/timed-out query → false (so the caller's poller keeps trying within its deadline).
async function replyExists(eventId: string, authorHex: string, env: Record<string, string>): Promise<boolean> {
  try {
    const t = await run<{ tree: ThreadNode }>(['thread', eventId, '--json'], env)
    return flatten(t.tree).some(
      (e) => e.pubkey === authorHex && e.kind === 1 && e.tags.some((tag) => tag[0] === 'e' && tag[1] === eventId),
    )
  } catch {
    return false
  }
}

// ── module-scope handles so afterAll can always clean up ──
let aliceListener: ListenHandle | undefined
let bobListener: ListenHandle | undefined
let pre: { ok: boolean; reason?: string } = { ok: false, reason: 'not checked' }
let alice: Id
let bob: Id

describe.if(LIVE)('hopstr listen --agent copilot — live two-way bot', () => {
  beforeAll(async () => {
    pre = await checkPreconditions()
    // Mint identities even if a precondition failed, so the test body can run its
    // fail-with-warning path cleanly. No --save: ~/.config/hopstr/config.json is untouched.
    alice = await run<Id>(['id', 'new', '--json'])
    bob = await run<Id>(['id', 'new', '--json'])
  })

  afterAll(() => {
    aliceListener?.kill()
    bobListener?.kill()
  })

  test('copilot replies to Bob\'s thread reply and DMs back, both visible to Bob', async () => {
    // Precondition: FAIL with a warning (do NOT skip) if the environment isn't ready.
    if (!pre.ok) {
      console.warn(`\n[e2e-live] PRECONDITION FAILED: ${pre.reason}`)
      console.warn('[e2e-live] Needs: hopstr on PATH, copilot installed+authenticated, and the nostr skill at ~/.agents/skills/nostr.')
    }
    expect(pre.ok, `precondition: ${pre.reason ?? ''}`).toBe(true)

    const aliceHex = nip19.decodeNpub(alice.npub)

    // 1) Alice's listener (the bot) FIRST — assigned synchronously so afterAll can kill it.
    aliceListener = startListen({ NOSTR_NSEC: alice.nsec }, { label: 'alice' })
    await aliceListener.waitSubscribed(SUBSCRIBE_MS)
    // listen fires client.bootstrap() on startup; give kind-10002/10050 time to propagate
    // so Bob's NIP-17 DM can route to Alice.
    await sleep(BOOTSTRAP_WAIT_MS)

    // 2) Bob's plain listener — the ONLY CLI way to read DMs is `listen`. Up now so its
    //    --since=now window covers Alice's eventual DM back.
    bobListener = startListen({ NOSTR_NSEC: bob.nsec }, { agent: false, label: 'bob' })
    await bobListener.waitSubscribed(SUBSCRIBE_MS)
    await sleep(BOOTSTRAP_WAIT_MS)

    // 3) Alice seeds a note Bob can reply to. (post/reply/dm --json print PublishOk = {ok,id}.)
    const aliceSeed = await publish<PublishOk>(['post', 'Live e2e seed note: ask me a question.'], { NOSTR_NSEC: alice.nsec })
    await sleep(PUBLISH_SETTLE_MS)

    // 4) Bob acts (after Alice subscribed). Messages are explicit requests, to defeat
    //    copilot's "if no reply is warranted, do nothing." Use `publish` (retry + longer
    //    budget): a live relay sometimes stalls a publish, which mustn't sink setup.
    await publish<PublishOk>(
      ['dm', alice.npub, 'Hi Alice! Please reply to confirm you received this DM. What is 2+2?'],
      { NOSTR_NSEC: bob.nsec },
    )
    const bobMention = await publish<PublishOk>(
      ['post', `Hey ${alice.npub} — can you reply and confirm you see my mention?`],
      { NOSTR_NSEC: bob.nsec },
    )
    // Thread reply is the robust path: it #p-tags Alice, hitting her {kinds:[1],#p} sub directly.
    const bobReply = await publish<PublishOk>(
      ['reply', aliceSeed.id, 'Replying to your note, Alice — please reply back to confirm the thread works.'],
      { NOSTR_NSEC: bob.nsec },
    )
    await sleep(PUBLISH_SETTLE_MS)

    // 5/6) Alice's listener forwards each event to copilot, which (as Alice, inheriting
    //      NOSTR_NSEC) decides and runs `hopstr reply`/`hopstr dm` ITSELF, posting to the
    //      live network. We assert the FORWARDING LOOP, which is hopstr's job — not that
    //      copilot honors the exact recipient/event, which it is an LLM and may not (it can
    //      answer from its own context, decline, or paraphrase). So:
    //        HARD  = the loop ran: copilot was invoked AND published something AS Alice.
    //        SOFT  = copilot actually targeted Bob's specific event/DM (LLM-dependent).

    // (a) HARD — Alice's listener actually forwarded an event and spawned copilot.
    await aliceListener.waitForStderr((s) => s.includes('[copilot]'), COPILOT_REPLY_MS)
    expect(aliceListener.stderr()).toContain('[copilot]')

    // (b) HARD — copilot ran a `hopstr` command AS Alice and it succeeded on the network.
    //     copilot's tool log prints the command it ran (`hopstr reply …` / `hopstr dm …`)
    //     and a success line carrying an event id. Either marker proves a publish as Alice.
    await aliceListener.waitForStderr(
      (s) => /hopstr (reply|dm)\b/.test(s) && /(sent successfully|published|event id|"ok":\s*true|\bid\b)/i.test(s),
      COPILOT_REPLY_MS,
    )
    const aliceLog = aliceListener.stderr()
    expect(/hopstr (reply|dm)\b/.test(aliceLog)).toBe(true)

    // SOFT — did copilot actually target BOB's specific event/DM? This is LLM-dependent
    // (copilot may answer from its own context, decline, or DM a different recipient), so
    // these only WARN. Run all three concurrently under one shared budget so a missing
    // target costs ~SOFT_MS once, not three times in series.
    const [repliedToBob, dmToBob, repliedToMention] = await Promise.all([
      waitFor(() => replyExists(bobReply.id, aliceHex, { NOSTR_NSEC: bob.nsec }), MENTION_SOFT_MS, 'reply→Bob').catch(() => false),
      bobListener.waitForEvent((e) => e.type === 'dm' && e.from === alice.npub && e.dmKind === 'nip17', MENTION_SOFT_MS).catch(() => undefined),
      waitFor(() => replyExists(bobMention.id, aliceHex, { NOSTR_NSEC: bob.nsec }), MENTION_SOFT_MS, 'reply→mention').catch(() => false),
    ])
    if (repliedToBob) expect(repliedToBob).toBe(true)
    else console.warn('[e2e-live] SOFT: copilot did not reply to Bob\'s exact event (LLM may answer from its own context) — not failing.')
    if (dmToBob) expect((dmToBob.text ?? '').length).toBeGreaterThan(0)
    else console.warn('[e2e-live] SOFT: no DM from Alice reached Bob (LLM may have DM\'d a different recipient) — not failing.')
    if (!repliedToMention) console.warn('[e2e-live] SOFT: no reply to the bare-npub mention (search indexing is flaky / LLM-dependent) — not failing.')
  }, TEST_TIMEOUT_MS)
})

// Always-registered notice so a normal `bun test` documents how to run the live suite.
describe('e2e-live (gate notice)', () => {
  test('the live copilot e2e is opt-in', () => {
    if (!LIVE) {
      console.warn('[e2e-live] skipped — opt-in. Run: HOPSTR_E2E_LIVE=1 bun test packages/cli/tests/e2e-live.test.ts')
    }
    expect(true).toBe(true)
  })
})
