# @hopstr/cli

> `hopstr` — a Nostr daemon for your terminal: listen for mentions, replies, DMs and reactions, and post/reply/dm/react back.

A thin CLI over [`@hopstr/agent`](../agent). `hopstr listen` streams your notifications as they happen (and announces your presence so others can DM you); the one-shot commands publish from the terminal or a script.

## Run it

The `bin` is a Bun entrypoint — no build step:

```bash
bun run packages/cli/src/index.ts --help
# or, once linked:
hopstr --help
```

## Identity

Resolved in priority order:

1. `NOSTR_NSEC` environment variable
2. `~/.config/hopstr/config.json` → `{ "nsec": "nsec1...", "relays": ["wss://..."] }`

```bash
export NOSTR_NSEC=nsec1...
hopstr listen
```

Don't have a key yet? Mint one — `id new` is the only command that doesn't need an
existing identity:

```bash
hopstr id new --json
# → {"nsec":"nsec1...","npub":"npub1..."}
```

The `nsec` is the whole identity (keep it secret); the `npub` is your public handle.
Add `--save` to write the new nsec straight into `~/.config/hopstr/config.json` so
you're ready to go without exporting anything:

```bash
hopstr id new --save
# mints a key, saves it to the config file (existing relays are preserved)
```

`--save` refuses to overwrite a config that already has an `nsec`, so you can't clobber
an existing identity by accident.

## Commands

```bash
hopstr id new            [--save]  [--json]
hopstr listen [--json] [--relay wss://...] [--since <when>]
              [--agent <name> | --exec '<cmd>'] [--max-concurrency <n>]
hopstr post  <content>            [--json] [--relay wss://...]
hopstr reply <event-id> <content> [--json] [--relay wss://...]
hopstr dm    <npub> <message>     [--json] [--relay wss://...]
hopstr react <event-id> [emoji]   [--json] [--relay wss://...]
hopstr thread <event-id>          [--json] [--relay wss://...]
hopstr profile get [<pubkey-or-npub>]            [--json] [--relay wss://...]
hopstr profile set --name "..." […] [--replace]  [--json] [--relay wss://...]
```

### `listen` — your live notification stream

```bash
hopstr listen --json | jq .
```

On startup it **bootstraps your network presence** (profile, relay list, DM relay
list, contacts) so other clients can find and message you, then streams events.
Each line is one notification:

| `type` | extra fields |
| --- | --- |
| `mention` / `reply` | `id`, `content` |
| `dm` | `text`, `dmKind` (`nip17` or `nip04`) — NIP-04 legacy DMs are decrypted inline |
| `reaction` | `emoji`, `targetId` |

All carry `from` (npub) and `at` (unix seconds). Without `--json` you get a
human-readable, labelled feed instead.

#### Forward to a coding agent — `--agent` / `--exec`

`listen` can hand each incoming **dm / mention / reply** to a coding-agent CLI as it
arrives. It's **fire-and-forget**: hopstr spawns the agent with the message text on
stdin (or as an argument) and does nothing with the result — no auto-reply, no output
parsing. Events are still printed to stdout, so you see everything that's dispatched.

```bash
hopstr listen --agent claude          # pipe each message to `claude -p`
hopstr listen --exec 'mytool run {}'  # or any command of your own
```

- `--agent <name>` — a built-in preset. Each knows the right headless flags and
  whether its tool wants the prompt on **stdin** or as an **argument**:

  | preset | invokes |
  | --- | --- |
  | `claude` | `claude -p --permission-mode acceptEdits` (prompt on stdin) |
  | `codex` | `codex exec --dangerously-bypass-approvals-and-sandbox <text>` |
  | `gemini` | `gemini --yolo -p <text>` |
  | `copilot` | `copilot --allow-all-tools --no-ask-user -p <text>` |
  | `aider` | `aider --yes-always --message <text>` |
  | `cursor` | `cursor-agent -p <text> --force` |
  | `amp` | `amp -x` (prompt on stdin) |
  | `opencode` | `opencode run <text>` |

  > **gemini** additionally requires a *trusted* working directory in headless mode —
  > export `GEMINI_CLI_TRUST_WORKSPACE=true` (or add `--skip-trust` via `--exec`), or it
  > exits without running. This is gemini's own safety gate, not a hopstr setting.

- `--exec '<cmd>'` — forward to any command (mutually exclusive with `--agent`). Put
  `{}` where the prompt text goes; **omit `{}` to pipe the prompt to stdin**. The
  command is split on whitespace — **no shell is invoked**, so there's no quoting or
  injection surface. `{}` may appear anywhere, even more than once.

  ```bash
  hopstr listen --exec 'mytool run {}'        # text passed as an argument
  hopstr listen --exec 'mytool --headless'    # text piped to stdin
  ```

- `--reply` — let the agent **answer on Nostr itself**. Instead of forwarding only the
  raw text, hopstr wraps it with the sender's context and the exact command to respond:
  `hopstr dm <npub> "…"` for a DM, `hopstr reply <event-id> "…"` for a mention/reply. The
  spawned agent inherits your `NOSTR_NSEC`, so its `hopstr` posts as you. hopstr itself
  stays fire-and-forget — it never reads the agent's output; the *agent* sends the reply.
  Requires `--agent` or `--exec`.

  ```bash
  hopstr listen --agent claude --reply   # a real two-way bot: DM it, it answers
  ```

  Without `--reply`, the agent just gets the raw message and its output is discarded
  (use this when piping to a non-agent tool that wouldn't understand the instruction).

- `--max-concurrency <n>` — cap parallel agent processes (default **4**). Excess events
  queue and run as slots free.

If the agent binary is missing or exits non-zero, hopstr logs it to stderr and keeps
listening — one bad run never stops the daemon. On `Ctrl-C`, in-flight agents are given
a chance to finish before exit. The listener never re-forwards your own posts/replies,
so `--reply` can't loop on itself.

> ⚠️ **Security.** Forwarding runs a coding agent with **auto-approve / edit
> permissions** on text written by **strangers on Nostr** — a direct remote
> prompt-injection vector. Run `hopstr listen --agent …` only in a **sandbox or a
> throwaway working directory**, never against a repo or machine you can't afford to
> have an agent modify. If a preset's baked-in flags ever drift from the tool's current
> CLI, `--exec` is the always-correct fallback where you supply the flags yourself.

### Posting & interacting

```bash
hopstr post "hello nostr"
hopstr reply <event-id> "totally agree"
hopstr dm npub1xyz… "hey!"          # sent as NIP-17 gift wrap
hopstr react nevent1abc… 🤙          # emoji defaults to +
```

### `thread` — see the whole conversation

Given **any** event in a discussion — the root, a reply somewhere in the middle, or
a [NIP-22](https://nips.nostr.com/22) comment — `thread` finds the thread root and
prints the entire tree, with the event you asked about marked. The id may be raw hex,
`note1…`, or `nevent1…`.

```bash
hopstr thread nevent1abc…
```

```
▸ alice: Anyone running Bun in prod?  (b0515780)
  └─ bob: yes, six months, zero issues  (f58d8032)  ← you asked about this
    └─ alice: what about memory under load?  (83524e2e)
```

Authors show their profile name (falling back to a short npub). With `--json` you get
the nested tree as `{ root, target, tree }` (where `target` is the event you queried):

```bash
hopstr thread nevent1abc… --json | jq .tree
```

### `profile` — read & update your kind-0 metadata

Show a profile (your own by default, or anyone's by pubkey/npub):

```bash
hopstr profile get                       # your own profile
hopstr profile get npub1xyz…             # someone else's
hopstr profile get npub1xyz… --json | jq .
```

```
name          Alice
about         building on nostr
website       https://alice.dev
nip05         alice@alice.dev
```

Update your own profile. Each `--<field> <value>` sets that field; **changes merge
onto your current profile**, so setting one field never wipes the others:

```bash
hopstr profile set --name "Alice" --about "building on nostr"
hopstr profile set --picture https://alice.dev/me.png
hopstr profile set --bot true            # coerced to a JSON boolean
hopstr profile set --pronouns they/them  # arbitrary fields are allowed too
```

Known fields (labelled in `get` output) span [NIP-01](https://nips.nostr.com/1) and
[NIP-24](https://nips.nostr.com/24): `name`, `display_name`, `about`, `website`,
`nip05`, `lud16`, `lud06`, `picture`, `banner`, `bot`. Any other field is accepted and
stored as a string.

- `--replace` overwrites the whole profile with exactly the fields you pass (everything
  else is dropped) instead of merging.
- An empty value (`--about ""`) **clears** that field — the key is removed entirely.
- Structured fields like `birthday` aren't settable via flags; use `--replace` with the
  fields you want from a script if you need them.

```bash
hopstr profile set --name "Alice" --about "starting fresh" --replace
```

## Options

| Flag | Meaning |
| --- | --- |
| `--json` | one JSON object per line (machine-readable) |
| `--save` | for `id new`: write the new nsec to `~/.config/hopstr/config.json` |
| `--relay <url>` | add a relay (repeatable); **replaces** the defaults when given |
| `--since <when>` | for `listen`: where to start. Accepts a unix timestamp, relative (`1h`, `2d ago`, `30m`), ISO date (`2025-06-01`), or natural (`yesterday`, `last week`) |
| `--agent <name>` | for `listen`: forward dm/mention/reply text to a coding-agent CLI (preset). See [Forward to a coding agent](#forward-to-a-coding-agent--agent--exec) |
| `--exec '<cmd>'` | for `listen`: forward to any command. `{}` = prompt as arg; omit `{}` to pipe to stdin. Mutually exclusive with `--agent` |
| `--reply` | for `listen`: tell the agent to reply on Nostr itself (it runs `hopstr dm`/`reply` with your identity). Needs `--agent` or `--exec` |
| `--max-concurrency <n>` | for `listen`: max parallel agent processes (default 4); excess events queue |
| `--help`, `-h` | show help |

## License

MIT
