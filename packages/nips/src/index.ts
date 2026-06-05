// @nostragent/nips — every NIP as a namespace (also available as subpath imports,
// e.g. `@nostragent/nips/nip23`, for tree-shaking).
export * as nip02 from './nip02.ts'
export * as nip09 from './nip09.ts'
export * as nip10 from './nip10.ts'
export * as nip18 from './nip18.ts'
export * as nip23 from './nip23.ts'
export * as nip25 from './nip25.ts'
export * as nip27 from './nip27.ts'
export * as nip47 from './nip47.ts'
export * as nip51 from './nip51.ts'
export * as nip57 from './nip57.ts'
export * as nip59 from './nip59.ts'
export * as nip17 from './nip17.ts'
export * as nip98 from './nip98.ts'

// long-tail clusters + the kind registry
export * as media from './media.ts'
export * as moderation from './moderation.ts'
export * as discovery from './discovery.ts'
export * as extra from './extra.ts'
export { kindInfo, KIND_REGISTRY, nipsWithKinds, type KindInfo } from './kinds.ts'
