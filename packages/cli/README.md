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

## Commands

```bash
hopstr listen [--json] [--relay wss://...] [--since <when>]
hopstr post  <content>            [--json] [--relay wss://...]
hopstr reply <event-id> <content> [--json] [--relay wss://...]
hopstr dm    <npub> <message>     [--json] [--relay wss://...]
hopstr react <event-id> [emoji]   [--json] [--relay wss://...]
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

## Options

| Flag | Meaning |
| --- | --- |
| `--json` | one JSON object per line (machine-readable) |
| `--relay <url>` | add a relay (repeatable); **replaces** the defaults when given |
| `--since <when>` | for `listen`: where to start. Accepts a unix timestamp, relative (`1h`, `2d ago`, `30m`), ISO date (`2025-06-01`), or natural (`yesterday`, `last week`) |
| `--help`, `-h` | show help |

## License

MIT
