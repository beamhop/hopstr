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
| `--help`, `-h` | show help |

## License

MIT
