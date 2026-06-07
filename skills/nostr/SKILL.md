---
name: nostr
description: Interact with the Nostr network using the hopstr CLI — create or load an identity, post notes, reply, react, send encrypted DMs, reconstruct threads, and listen live for mentions/replies/DMs/reactions. Use this whenever the user asks you to post to Nostr, reply or react to a Nostr note, DM someone on Nostr, read a thread, watch for mentions/notifications, or "act like a human on Nostr" via hopstr.
---

# Nostr via hopstr

The `hopstr` CLI lets you act on the Nostr network as a real participant. An identity is just a keypair — no signup, no server. You publish signed events to relays (websocket servers) and read events back.

This skill assumes `hopstr` is installed and on your PATH. Check with:

```bash
hopstr --help
```

## Core principle for agents

- **Always pass `--json`** and parse stdout. Human-readable output is for people, not for you.
- Publish commands return one JSON line: `{"ok":true,"id":"<hex>"}`. **Read the `id` field** — that's the event id you keep to reply or react later.

## 1. Identity setup (do this first)

Every command except `id new` needs a secret key. hopstr resolves it in this order:

1. `NOSTR_NSEC` environment variable
2. `~/.config/hopstr/config.json` → `{ "nsec": "nsec1...", "relays": ["wss://..."] }`

Check whether one is configured:

```bash
echo "$NOSTR_NSEC"
cat ~/.config/hopstr/config.json 2>/dev/null
```

If **neither** is set, every command exits with:

```
error: no identity found.
```

To get set up, either:

- **The user gives you an nsec** — export it for the session:
  ```bash
  export NOSTR_NSEC=nsec1...
  ```
  (Or have the user save `{ "nsec": "nsec1...", "relays": ["wss://relay.damus.io"] }` to `~/.config/hopstr/config.json`.)

- **Mint a brand-new identity** with `hopstr id new`:
  ```bash
  hopstr id new --json
  # → {"nsec":"nsec1...","npub":"npub1..."}
  ```
  Then show the user the **npub** (their public handle), `export NOSTR_NSEC=<the nsec>`, and tell them to save the nsec somewhere safe — it is the whole identity and cannot be recovered.

  Or have hopstr persist it for you with `--save` (writes the nsec to
  `~/.config/hopstr/config.json`, keeping any existing relays; it won't overwrite a
  config that already has an nsec):
  ```bash
  hopstr id new --save --json
  # → {"nsec":"...","npub":"...","saved":"~/.config/hopstr/config.json"}
  ```

**The nsec is a SECRET key.** Never post it, never log it, never put it in an event or a message. Sharing the `npub` is fine and expected.

## 2. Posting and interacting

Each command resolves the identity automatically and prints `{"ok":true,"id":"<hex>"}` with `--json`.

**Post a note** (kind-1):
```bash
hopstr post "hello nostr" --json
# → {"ok":true,"id":"<hex>"}
```

**Reply to a note** (NIP-10 threaded reply; notifies the author). The event-id may be hex, `note1...`, or `nevent1...`:
```bash
hopstr reply <event-id> "totally agree" --json
# → {"ok":true,"id":"<hex>"}
```

**React** (kind-7 like; emoji defaults to `+`):
```bash
hopstr react <event-id> --json        # like (+)
hopstr react <event-id> "🔥" --json    # emoji reaction
# → {"ok":true,"id":"<hex>"}
```

**Send an encrypted DM** (NIP-17 gift-wrapped; only you and the recipient can read it). Target is an `npub` or hex pubkey:
```bash
hopstr dm npub1xyz... "private hello" --json
# → {"ok":true,"id":"<hex>"}
```

In every case, parse the line and keep `id` if you might reference the event later.

## 3. Manage your profile

Your profile is kind-0 metadata (NIP-01 + NIP-24): name, bio, picture, etc. A fresh
identity has none — set one before posting so you don't appear as a bare pubkey.

**Read a profile** (your own by default, or anyone's by npub/pubkey):
```bash
hopstr profile get --json
# → {"name":"Alice","about":"...","picture":"https://..."}   (or {} if none set)
hopstr profile get npub1xyz... --json
```

**Set/update your profile.** Each `--<field> <value>` is merged onto your current
profile, so setting one field never wipes the others:
```bash
hopstr profile set --name "Alice" --about "building on nostr" --json
# → {"ok":true,"id":"<hex>"}
hopstr profile set --picture https://alice.dev/me.png --json   # name/about preserved
```

- Common fields: `name`, `display_name`, `about`, `website`, `nip05`, `lud16`, `picture`,
  `banner`, `bot` (use `--bot true`). Any other field is accepted too.
- `--about ""` (empty value) **clears** that field.
- `--replace` overwrites the whole profile with only the fields you pass.

## 4. Reading a thread for context

Before replying, pull the full conversation tree from any event in it. Accepts hex / `note1` / `nevent1`:

```bash
hopstr thread <event-id> --json
```

Returns:
```json
{"root":<event>,"target":<event>,"tree":{"event":<event>,"children":[<node>,...]}}
```

- `root` = the top of the thread, `target` = the event you asked about.
- Walk `tree.children` recursively; each node is `{ "event": <event>, "children": [...] }`.
- An `<event>` has at least `id`, `pubkey`, `content`, `created_at`, `tags`.

Use this to understand who said what before crafting a reply.

## 5. Listening (live) — MUST run in the background

`listen` streams notifications (mentions, replies, DMs, reactions) and **never exits — it blocks forever**. Do **not** run it in the foreground; it will hang your turn. Run it in the background, write its JSON to a file, then read/tail that file.

- **stdout** = events, one JSON object per line.
- **stderr** = status lines you can ignore for parsing: `listening as npub...`, `pubkey: ...`, `relays: ...`, `since: ...`, `---`.
- On startup it also bootstraps your network presence (profile kind-0, relay lists kind-10002/10050, contacts kind-3) so others can find and DM you. This is fire-and-forget and idempotent — it never overwrites an existing profile or follow list.

Agent pattern — background it (use `run_in_background`), JSON events → a file in `/tmp`, then read the file as events arrive:

```bash
# launch in the background; events → a file, status/stderr → a separate log
hopstr listen --json --since 1h \
  > /tmp/hopstr-events.jsonl 2> /tmp/hopstr-listen.log
# then, separately, read new lines as they appear:
tail -f /tmp/hopstr-events.jsonl
```

Process each line of `/tmp/hopstr-events.jsonl` as a JSON event (shapes below). **Stop/kill the background process when you're done.**

**`--since <when>`** controls how far back to start (default: **now**, so by default you only see events that arrive *after* you start). Accepts:
- unix timestamp — `1749200000`
- relative — `1h`, `30m`, `2d ago`
- ISO date — `2025-06-01`
- natural — `now`, `today`, `yesterday`, `last week`, `last month`

Use `--since 1h` (or longer) to backfill recent activity instead of waiting for new events.

### JSON event shapes from `listen`

Every event has `from` (an **npub**) and `at` (unix seconds).

```json
{"type":"mention","from":"npub1...","id":"<hex>","content":"...","at":1749200000}
{"type":"reply","from":"npub1...","id":"<hex>","content":"...","at":1749200000}
{"type":"dm","from":"npub1...","text":"...","at":1749200000,"dmKind":"nip17"}
{"type":"reaction","from":"npub1...","emoji":"🔥","at":1749200000,"targetId":"<hex>"}
```

- `mention` / `reply`: the `id` is **that incoming note's** event id — reply or react to *it* using that id.
- `dm`: `dmKind` is `"nip17"` (modern) or `"nip04"` (legacy, decrypted inline). To answer, `hopstr dm <from-npub> "..."`.
- `reaction`: `emoji` is the reaction; `targetId` (optional) is the event of yours they reacted to.

### Forwarding to a coding-agent CLI — `--agent` / `--exec`

Instead of parsing events yourself, `listen` can hand each incoming **dm / mention /
reply** straight to a coding-agent CLI. This is **fire-and-forget**: hopstr spawns the
agent with the message text and does nothing with the result (no auto-reply). Events
are still printed to stdout as usual.

```bash
hopstr listen --json --agent claude          # pipe each message to a `claude` run
hopstr listen --json --exec 'mytool run {}'  # or any command; {} = prompt as arg
hopstr listen --json --exec 'mytool'         # no {} → prompt piped to the command's stdin
```

- `--agent <name>` presets: `claude`, `codex`, `gemini`, `copilot`, `aider`, `cursor`,
  `amp`, `opencode` (each carries the right headless / auto-approve flags).
- `--exec '<cmd>'` runs any command (no shell, split on whitespace). Mutually exclusive
  with `--agent`.
- `--max-concurrency <n>` caps parallel agent processes (default 4).

> ⚠️ **Security.** This runs a coding agent with auto-approve/edit permissions on text
> from **strangers on Nostr** (a remote prompt-injection vector). Use it only in a
> **sandbox or throwaway working directory**, never against a repo or machine an agent
> shouldn't be allowed to modify.

## 6. A typical agent loop (listen → decide → act)

1. Start `hopstr listen --json --since 1h` in the background, writing to `/tmp/hopstr-events.jsonl`.
2. For each new line, parse the JSON event.
3. For a `mention` or `reply`, run `hopstr thread <id> --json` to get conversation context.
4. Decide a natural, human response — don't spam, don't reveal the nsec.
5. Act:
   - reply: `hopstr reply <incoming-event-id> "..." --json`
   - react: `hopstr react <incoming-event-id> "🔥" --json`
   - answer a DM: `hopstr dm <from-npub> "..." --json`
6. Keep the returned `id` if you'll need it later. Stop the background `listen` when finished.

## 7. Identifiers and safety

- `npub1...` = public key, the shareable handle of an account. Safe to print.
- `nsec1...` = **SECRET key**. Never post, log, or message it. It is the entire identity.
- Event ids: 64-char hex, or `note1...` / `nevent1...` bech32. All three are accepted wherever an `<event-id>` is needed.
- The `from` field in `listen` events is always an npub. To reply or react you need the event **`id`** (hex), which is in the event.

## 8. Relays

Default relays: `relay.damus.io`, `nos.lol`, `relay.primal.net`, `relay.nostr.band`.

`--relay <url>` is repeatable but **replaces** the defaults (it is not additive) — if you pass any `--relay`, only those are used:

```bash
hopstr post "hi" --json --relay wss://relay.damus.io --relay wss://nos.lol
```

## 9. Troubleshooting

- **`error: no identity found.`** → no `NOSTR_NSEC` and no `~/.config/hopstr/config.json`. Set one, or mint a fresh identity with `hopstr id new` (see Identity setup).
- **`listen` shows nothing** → by default `--since` is *now*, so you only see events that arrive after you start. Add `--since 1h` (or `yesterday`) to backfill recent activity. Quiet accounts may simply have no recent mentions.
- **Replies/reacts to an old note find nothing** → the target event may not be on the default relays. Point at the right relay with `--relay wss://...` (remember it replaces defaults, so include the ones you need).
- **DM says recipient "hasn't enabled encrypted messaging"** → they have no published DM relay list (kind-10050). Running `listen` once publishes *yours*; the recipient must have published theirs.
- **Command hangs and never returns** → that's `listen` (it blocks forever). Run it in the background, not the foreground.
- **`hopstr: command not found`** → the CLI isn't installed or isn't on your PATH. Install it, or confirm with `which hopstr`.
