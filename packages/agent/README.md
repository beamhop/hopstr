# @hopstr/agent

> Velvet's easy mode: the drop-in `NostrClient` and the autonomous `runAgent` loop, over the full stack.

If you just want to *be on Nostr* — post, reply, follow, DM, run a bot — this is the one package to import. It's a thin, batteries-included facade over [`@hopstr/client`](../client) + [`@hopstr/nips`](../nips), with the exact method names and JSON shapes the `nostr-agent` CLI uses.

## Install

```bash
bun add @hopstr/agent
```

## Be a person on Nostr

```ts
import { NostrClient, createIdentity } from '@hopstr/agent'

const me = createIdentity()                       // or loadIdentity(nsec)
const nostr = new NostrClient(me)                 // default relays, ready to go

await nostr.post('gm', [['t', 'coffee']])         // → { ok: true, id }
await nostr.reply(eventId, 'totally agree')        // threaded (NIP-10)
await nostr.react(eventId, '🔥')                   // like / emoji
await nostr.repost(eventId)

const feed = await nostr.feed({ limit: 20 })       // [{ id, author, created_at, content, tags }]
const tagged = await nostr.hashtag('bitcoin')
const myMentions = await nostr.mentions()          // notes mentioning you (your notifications)

await nostr.follow(npubOrHex)
const follows = await nostr.following()            // hex pubkeys you follow

await nostr.setProfile({ name: 'alice', about: 'velvet dev' })
const profile = await nostr.getProfile(npubOrHex)
```

## Private messages — NIP-17 by default

```ts
await nostr.sendDM(bobNpub, 'private hello')        // gift-wrapped (kind 1059), to bob + a copy to you
const convo = await nostr.readDMs(bobNpub)          // [{ from, text, at }] — NIP-17, plus legacy kind-4 reads
```

DMs use **NIP-17 gift wrap** (metadata-private) and also *read* old kind-4 conversations, so nothing disappears in the upgrade.

## Autonomous mode — `runAgent`

A closed loop: subscribe to live notes, ask a brain how a thoughtful person would respond, and reply/react automatically.

```ts
import { runAgent } from '@hopstr/agent'

const stop = runAgent(nostr, {
  watch: 'mentions',                                // or 'feed'
  persona: { about: 'a Bitcoin dev with dry humor', model: 'gpt-5.2' },
  onDecision: (note, d) => console.log(d.action, d.reason),
})
// ...later: stop()
```

By default the brain is the **GitHub Copilot CLI** (`copilot -p … --output-format json --allow-all-tools`); pass your own `runner` to swap it (the loop, `decide`, `parseDecision`, and `extractContent` are all unit-tested with a fake runner). It never replies to its own notes and acts on each note once.

## License

MIT
