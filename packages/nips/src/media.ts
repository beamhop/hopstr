// Media NIPs: NIP-92 imeta attachments, NIP-94 file metadata (kind 1063),
// NIP-68 picture posts (kind 20), NIP-71 video events (kind 21/22).
import type { EventTemplate, NostrEvent } from '@nostragent/core'

// ── NIP-92: imeta tags ──

export interface Imeta {
  url: string
  m?: string // mime type
  blurhash?: string
  dim?: string // WxH
  alt?: string
  x?: string // sha256
  [key: string]: string | undefined
}

/** Build an `imeta` tag (space-separated `key value` pairs) from a description. */
export function imetaTag(meta: Imeta): string[] {
  const tag = ['imeta']
  for (const [key, value] of Object.entries(meta)) if (value !== undefined) tag.push(`${key} ${value}`)
  return tag
}

/** Parse all `imeta` tags out of an event. */
export function parseImeta(event: NostrEvent): Imeta[] {
  return event.tags
    .filter((t) => t[0] === 'imeta')
    .map((t) => {
      const meta: Imeta = { url: '' }
      for (const part of t.slice(1)) {
        const space = part.indexOf(' ')
        if (space === -1) continue
        meta[part.slice(0, space)] = part.slice(space + 1)
      }
      return meta
    })
}

// ── NIP-94: file metadata (kind 1063) ──

export interface FileMetadata {
  url: string
  mimeType: string
  hash: string // sha256 hex
  size?: number
  dim?: string
  blurhash?: string
  summary?: string
}

export function fileMetadata(file: FileMetadata, description = ''): EventTemplate {
  const tags: string[][] = [
    ['url', file.url],
    ['m', file.mimeType],
    ['x', file.hash],
  ]
  if (file.size !== undefined) tags.push(['size', String(file.size)])
  if (file.dim) tags.push(['dim', file.dim])
  if (file.blurhash) tags.push(['blurhash', file.blurhash])
  if (file.summary) tags.push(['summary', file.summary])
  return { kind: 1063, content: description, tags }
}

export function parseFileMetadata(event: NostrEvent): FileMetadata {
  const tag = (name: string): string | undefined => event.tags.find((t) => t[0] === name)?.[1]
  const size = tag('size')
  const out: FileMetadata = { url: tag('url') ?? '', mimeType: tag('m') ?? '', hash: tag('x') ?? '' }
  const dim = tag('dim')
  const blurhash = tag('blurhash')
  const summary = tag('summary')
  if (size) out.size = Number(size)
  if (dim) out.dim = dim
  if (blurhash) out.blurhash = blurhash
  if (summary) out.summary = summary
  return out
}

// ── NIP-68: picture-first post (kind 20) ──

export function picturePost(caption: string, images: Imeta[], hashtags: string[] = []): EventTemplate {
  const tags = images.map(imetaTag)
  for (const t of hashtags) tags.push(['t', t])
  return { kind: 20, content: caption, tags }
}

// ── NIP-71: video event (kind 21 normal, 22 short/portrait) ──

export interface VideoInput {
  title: string
  description?: string
  videos: Imeta[]
  short?: boolean
  duration?: number
}

export function videoEvent(v: VideoInput): EventTemplate {
  const tags: string[][] = [['title', v.title]]
  for (const m of v.videos) tags.push(imetaTag(m))
  if (v.duration !== undefined) tags.push(['duration', String(v.duration)])
  return { kind: v.short ? 22 : 21, content: v.description ?? '', tags }
}
