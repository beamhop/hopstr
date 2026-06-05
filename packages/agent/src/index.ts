// @nostragent/agent — the easy-mode facade + autonomous loop, plus the kernel
// primitives the CLI needs. A one-stop drop-in import.
export {
  NostrClient,
  DEFAULT_RELAYS,
  createIdentity,
  loadIdentity,
  type Identity,
  type FeedNote,
  type DM,
  type PublishOk,
} from './facade.ts'

export {
  runAgent,
  decide,
  parseDecision,
  extractContent,
  copilotRunner,
  type Persona,
  type Decision,
  type CopilotRunner,
  type RunAgentOptions,
} from './agent.ts'

// re-export the modern client + kernel types for power users
export { Nostr } from '@nostragent/client'
export type { NostrEvent, Filter, Pubkey, EventTemplate } from '@nostragent/core'
