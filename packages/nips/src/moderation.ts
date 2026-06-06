// Moderation NIPs: NIP-56 reporting (kind 1984), NIP-32 labels (kind 1985),
// NIP-36 sensitive content (content-warning tag).
import type { EventTemplate, NostrEvent } from '@hopstr/core'

// ── NIP-56: reporting ──

export type ReportType = 'nudity' | 'malware' | 'profanity' | 'illegal' | 'spam' | 'impersonation' | 'other'

export interface ReportInput {
  /** the reported event id (omit to report a pubkey only) */
  eventId?: string
  /** the reported pubkey */
  pubkey: string
  type: ReportType
  reason?: string
}

export function report(input: ReportInput): EventTemplate {
  const tags: string[][] = [['p', input.pubkey, input.type]]
  if (input.eventId) tags.push(['e', input.eventId, input.type])
  return { kind: 1984, content: input.reason ?? '', tags }
}

export interface ParsedReport {
  pubkey?: string
  eventId?: string
  type?: string
  reason: string
}

export function parseReport(event: NostrEvent): ParsedReport {
  const p = event.tags.find((t) => t[0] === 'p')
  const e = event.tags.find((t) => t[0] === 'e')
  const out: ParsedReport = { reason: event.content }
  if (p?.[1]) out.pubkey = p[1]
  if (e?.[1]) out.eventId = e[1]
  const type = e?.[2] ?? p?.[2]
  if (type) out.type = type
  return out
}

// ── NIP-32: labeling (kind 1985) ──

export interface LabelInput {
  /** the label namespace, e.g. "ISO-639-1", "#t", "social" */
  namespace: string
  /** the label values */
  labels: string[]
  /** what's being labeled: events and/or pubkeys */
  eventIds?: string[]
  pubkeys?: string[]
}

export function label(input: LabelInput): EventTemplate {
  const tags: string[][] = [['L', input.namespace]]
  for (const l of input.labels) tags.push(['l', l, input.namespace])
  for (const id of input.eventIds ?? []) tags.push(['e', id])
  for (const pk of input.pubkeys ?? []) tags.push(['p', pk])
  return { kind: 1985, content: '', tags }
}

export interface ParsedLabels {
  namespace?: string
  values: string[]
  eventIds: string[]
  pubkeys: string[]
}

export function parseLabels(event: NostrEvent): ParsedLabels {
  const namespace = event.tags.find((t) => t[0] === 'L')?.[1]
  const out: ParsedLabels = {
    values: event.tags.filter((t) => t[0] === 'l' && t[1]).map((t) => t[1]!),
    eventIds: event.tags.filter((t) => t[0] === 'e' && t[1]).map((t) => t[1]!),
    pubkeys: event.tags.filter((t) => t[0] === 'p' && t[1]).map((t) => t[1]!),
  }
  if (namespace) out.namespace = namespace
  return out
}

// ── NIP-36: sensitive content ──

/** Add a NIP-36 content-warning tag to any template. */
export function withContentWarning(template: EventTemplate, reason = ''): EventTemplate {
  return { ...template, tags: [...template.tags, ['content-warning', reason]] }
}

/** The content warning on an event, or null if none. */
export function contentWarning(event: NostrEvent): string | null {
  const tag = event.tags.find((t) => t[0] === 'content-warning')
  return tag ? (tag[1] ?? '') : null
}
