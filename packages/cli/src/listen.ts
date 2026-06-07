import { nip17, nip10 } from '@hopstr/nips'
import { nip19 } from '@hopstr/core'
import { NostrClient } from '@hopstr/agent'
import type { Identity } from '@hopstr/core'
import type { NostrEvent } from '@hopstr/core'
import { prettyPrint, jsonLine, type FormattedEvent } from './format.ts'
import { makeForwarder, type Preset } from './forward.ts'
import { buildPrompt } from './prompt.ts'

export async function listen(
  identity: Identity,
  opts: { json: boolean; relays?: string[]; since?: number; preset?: Preset; maxConcurrency?: number; reply?: boolean },
): Promise<void> {
  const client = new NostrClient(identity, opts.relays)
  const emitOut = opts.json ? jsonLine : prettyPrint

  // When --agent/--exec is set, forward dm/mention/reply to a coding-agent CLI
  // (fire-and-forget) in addition to printing. Reactions have no text, so they're
  // never forwarded. With --reply the prompt tells the agent how to answer via the
  // `hopstr` CLI (it inherits our NOSTR_NSEC); otherwise it's just the raw text.
  // SIGINT lets in-flight agents finish instead of being orphaned.
  const forwarder = opts.preset ? makeForwarder(opts.preset, opts.maxConcurrency ?? 4) : undefined
  if (forwarder) {
    console.error(`forwarding dm/mention/reply → ${opts.preset!.bin}${opts.reply ? ' (self-reply)' : ''}`)
    process.once('SIGINT', () => void forwarder.drain().finally(() => process.exit(0)))
  }
  function emit(ev: FormattedEvent): void {
    emitOut(ev)                                   // still print so the user sees activity
    if (forwarder && ev.type !== 'reaction') {
      const prompt = buildPrompt(ev, opts.reply ?? false)
      if (prompt) forwarder.forward(prompt)
    }
  }

  const myPubkey = identity.pubkey
  const seen = new Set<string>()

  function dedupe(id: string): boolean {
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }

  const since = opts.since ?? Math.floor(Date.now() / 1000)

  console.error(`listening as ${identity.npub}`)
  console.error(`pubkey: ${myPubkey}`)
  console.error(`relays: ${(opts.relays ?? []).join(', ') || 'defaults'}`)
  console.error(`since: ${new Date(since * 1000).toISOString()}`)
  console.error('---')

  // Establish full network presence on connect: profile (kind-0), relay list
  // (kind-10002), DM relay list (kind-10050), and contact list (kind-3). This is
  // what makes us discoverable and DM-able — without the relay/DM lists, clients
  // show "user has not enabled encrypted messaging yet". Idempotent and safe:
  // kind-0/kind-3 are only created if missing, so an existing profile or follow
  // list is never overwritten. Fire-and-forget so we don't block the listener.
  // https://nips.nostr.com/17  https://nips.nostr.com/65
  client.bootstrap().catch(() => {})

  function onNote(event: NostrEvent): void {
    if (!dedupe(event.id) || event.pubkey === myPubkey) return
    const thread = nip10.parseThread(event)
    const isReply = Boolean(thread.root || thread.reply)
    emit({
      type: isReply ? 'reply' : 'mention',
      from: nip19.encodeNpub(event.pubkey),
      id: event.id,
      content: event.content,
      at: event.created_at,
    })
  }

  // mentions + replies: kind 1 where our pubkey is properly tagged
  client.subscribe({ kinds: [1], '#p': [myPubkey], since }, onNote)

  // bare-text mentions: clients like Ditto write the npub in content without a #p tag.
  // relay.nostr.band supports NIP-50 search; dedupe handles overlap with the above.
  client.nostr.subscribe(
    { kinds: [1], search: identity.npub, since },
    { relays: ['wss://relay.nostr.band'] },
  ).on('event', (e) => onNote(e as NostrEvent))

  // NIP-17 gift-wrapped DMs
  client.subscribe({ kinds: [1059], '#p': [myPubkey], since }, (event: NostrEvent) => {
    if (!dedupe(event.id)) return
    try {
      const msg = nip17.openDirectMessage(event, identity.secretKey)
      // Skip our own messages: sendDM delivers a self-copy, which would otherwise
      // get re-forwarded to the agent under --reply and loop forever.
      if (msg.from === myPubkey) return
      emit({
        type: 'dm',
        from: nip19.encodeNpub(msg.from),
        text: msg.text,
        at: msg.at,
        dmKind: 'nip17',
      })
    } catch {
      // not a DM for us or unreadable
    }
  })

  // Legacy NIP-04 DMs (kind 4) — decrypt inline so the plaintext is printed.
  client.subscribe({ kinds: [4], '#p': [myPubkey], since }, (event: NostrEvent) => {
    if (!dedupe(event.id) || event.pubkey === myPubkey) return
    const text = client.decryptLegacyDM(event)
    if (text === null) return // not for us / undecryptable
    emit({
      type: 'dm',
      from: nip19.encodeNpub(event.pubkey),
      text,
      at: event.created_at,
      dmKind: 'nip04',
    })
  })

  // Reactions to our notes (kind 7)
  client.subscribe({ kinds: [7], '#p': [myPubkey], since }, (event: NostrEvent) => {
    if (!dedupe(event.id) || event.pubkey === myPubkey) return
    const targetId = event.tags.findLast((t) => t[0] === 'e')?.[1]
    const reaction: FormattedEvent = {
      type: 'reaction',
      from: nip19.encodeNpub(event.pubkey),
      emoji: event.content,
      at: event.created_at,
    }
    if (targetId) reaction.targetId = targetId
    emit(reaction)
  })

  // Keep process alive
  await new Promise<never>(() => {})
}
