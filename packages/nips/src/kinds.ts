// The Nostr kind registry: every known event kind → its meaning, behavior class,
// and defining NIP. Sourced from the canonical nostr-protocol/nips index. This is
// the backbone that lets the library handle (render/classify) any event generically
// and lets the coverage meta-test prove every NIP has a home.
import { classifyKind, type KindClass } from '@hopstr/core'

export interface KindInfo {
  kind: number
  label: string
  /** the NIP that defines it (e.g. "01", "59", "B7") */
  nip: string
  /** regular | replaceable | ephemeral | addressable (NIP-01 ranges) */
  behavior: KindClass
}

// kind → [label, nip]. Behavior is derived from the NIP-01 ranges via classifyKind.
const ENTRIES: Array<[number, string, string]> = [
  [0, 'User Metadata', '01'],
  [1, 'Short Text Note', '10'],
  [3, 'Follows', '02'],
  [4, 'Encrypted Direct Messages (legacy)', '04'],
  [5, 'Event Deletion Request', '09'],
  [6, 'Repost', '18'],
  [7, 'Reaction', '25'],
  [8, 'Badge Award', '58'],
  [9, 'Chat Message', 'C7'],
  [11, 'Thread', '7D'],
  [13, 'Seal', '59'],
  [14, 'Direct Message', '17'],
  [15, 'File Message', '17'],
  [16, 'Generic Repost', '18'],
  [17, 'Reaction to a website', '25'],
  [20, 'Picture', '68'],
  [21, 'Video Event', '71'],
  [22, 'Short-form Portrait Video Event', '71'],
  [24, 'Public Message', 'A4'],
  [40, 'Channel Creation', '28'],
  [41, 'Channel Metadata', '28'],
  [42, 'Channel Message', '28'],
  [43, 'Channel Hide Message', '28'],
  [44, 'Channel Mute User', '28'],
  [54, 'Podcast Episode', 'F4'],
  [62, 'Request to Vanish', '62'],
  [64, 'Chess (PGN)', '64'],
  [818, 'Merge Requests', '54'],
  [1018, 'Poll Response', '88'],
  [1021, 'Bid', '15'],
  [1022, 'Bid confirmation', '15'],
  [1040, 'OpenTimestamps', '03'],
  [1059, 'Gift Wrap', '59'],
  [1063, 'File Metadata', '94'],
  [1068, 'Poll', '88'],
  [1111, 'Comment', '22'],
  [1222, 'Voice Message', 'A0'],
  [1244, 'Voice Message Comment', 'A0'],
  [1311, 'Live Chat Message', '53'],
  [1337, 'Code Snippet', 'C0'],
  [1617, 'Patches', '34'],
  [1621, 'Issues', '34'],
  [1622, 'Git Replies (deprecated)', '34'],
  [1984, 'Reporting', '56'],
  [1985, 'Label', '32'],
  [2003, 'Torrent', '35'],
  [2004, 'Torrent Comment', '35'],
  [4550, 'Community Post Approval', '72'],
  [7374, 'Reserved Cashu Wallet Tokens', '60'],
  [7375, 'Cashu Wallet Tokens', '60'],
  [7376, 'Cashu Wallet History', '60'],
  [7516, 'Geocache log', 'CC'],
  [8000, 'Add User', '43'],
  [9041, 'Zap Goal', '75'],
  [9321, 'Nutzap', '61'],
  [9734, 'Zap Request', '57'],
  [9735, 'Zap', '57'],
  [9802, 'Highlights', '84'],
  [10000, 'Mute list', '51'],
  [10001, 'Pin list', '51'],
  [10002, 'Relay List Metadata', '65'],
  [10003, 'Bookmark list', '51'],
  [10004, 'Communities list', '51'],
  [10005, 'Public chats list', '51'],
  [10006, 'Blocked relays list', '51'],
  [10007, 'Search relays list', '51'],
  [10009, 'User groups', '29'],
  [10011, 'External Identities', '39'],
  [10015, 'Interests list', '51'],
  [10019, 'Nutzap Mint Recommendation', '61'],
  [10020, 'Media follows', '51'],
  [10030, 'User emoji list', '51'],
  [10050, 'Relay list to receive DMs', '17'],
  [10063, 'User server list', 'B7'],
  [10166, 'Relay Monitor Announcement', '66'],
  [13194, 'Wallet Info', '47'],
  [22242, 'Client Authentication', '42'],
  [23194, 'Wallet Request', '47'],
  [23195, 'Wallet Response', '47'],
  [24133, 'Nostr Connect', '46'],
  [24242, 'Blobs stored on mediaservers', 'B7'],
  [27235, 'HTTP Auth', '98'],
  [30000, 'Follow sets', '51'],
  [30002, 'Relay sets', '51'],
  [30003, 'Bookmark sets', '51'],
  [30008, 'Profile Badges', '58'],
  [30009, 'Badge Definition', '58'],
  [30017, 'Create or update a stall', '15'],
  [30018, 'Create or update a product', '15'],
  [30023, 'Long-form Content', '23'],
  [30024, 'Draft Long-form Content', '23'],
  [30030, 'Emoji sets', '51'],
  [30078, 'Application-specific Data', '78'],
  [30166, 'Relay Discovery', '66'],
  [30311, 'Live Event', '53'],
  [30315, 'User Statuses', '38'],
  [30382, 'User Trusted Assertion', '85'],
  [30402, 'Classified Listing', '99'],
  [30617, 'Repository announcements', '34'],
  [30818, 'Wiki article', '54'],
  [31234, 'Draft Event', '37'],
  [31922, 'Date-Based Calendar Event', '52'],
  [31923, 'Time-Based Calendar Event', '52'],
  [31989, 'Handler recommendation', '89'],
  [31990, 'Handler information', '89'],
  [34235, 'Addressable Video Event', '71'],
  [34550, 'Community Definition', '72'],
  [38172, 'Cashu Mint Announcement', '87'],
  [38383, 'Peer-to-peer Order events', '69'],
  [39701, 'Web bookmarks', 'B0'],
]

export const KIND_REGISTRY: ReadonlyMap<number, KindInfo> = new Map(
  ENTRIES.map(([kind, label, nip]) => [kind, { kind, label, nip, behavior: classifyKind(kind) }]),
)

/** Describe any kind — known kinds get a label + NIP; unknown ones still get a behavior. */
export function kindInfo(kind: number): KindInfo {
  return KIND_REGISTRY.get(kind) ?? { kind, label: `Unknown (kind ${kind})`, nip: '?', behavior: classifyKind(kind) }
}

/** Every NIP number that the registry knows defines at least one kind. */
export function nipsWithKinds(): Set<string> {
  return new Set([...KIND_REGISTRY.values()].map((k) => k.nip))
}
