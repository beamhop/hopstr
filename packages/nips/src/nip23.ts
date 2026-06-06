// NIP-23: long-form content (kind 30023, addressable markdown articles).
import type { EventTemplate, NostrEvent } from '@hopstr/core'

export interface Article {
  /** the `d` identifier (slug) — stable across edits */
  slug: string
  title?: string
  summary?: string
  image?: string
  /** unix seconds of first publication */
  publishedAt?: number
  hashtags?: string[]
  /** markdown body */
  markdown: string
}

/** Build a kind-30023 long-form article. */
export function article(a: Article): EventTemplate {
  const tags: string[][] = [['d', a.slug]]
  if (a.title) tags.push(['title', a.title])
  if (a.summary) tags.push(['summary', a.summary])
  if (a.image) tags.push(['image', a.image])
  if (a.publishedAt) tags.push(['published_at', String(a.publishedAt)])
  for (const t of a.hashtags ?? []) tags.push(['t', t])
  return { kind: 30023, content: a.markdown, tags }
}

/** A kind-30024 draft (same shape, not yet published). */
export function draft(a: Article): EventTemplate {
  return { ...article(a), kind: 30024 }
}

/** Parse a kind-30023/30024 article. */
export function parseArticle(event: NostrEvent): Article {
  const tag = (name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
  const publishedAt = tag('published_at')
  const out: Article = {
    slug: tag('d') ?? '',
    markdown: event.content,
    hashtags: event.tags.filter((t) => t[0] === 't' && t[1]).map((t) => t[1]!),
  }
  const title = tag('title')
  const summary = tag('summary')
  const image = tag('image')
  if (title) out.title = title
  if (summary) out.summary = summary
  if (image) out.image = image
  if (publishedAt) out.publishedAt = Number(publishedAt)
  return out
}
