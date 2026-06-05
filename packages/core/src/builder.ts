// A tiny fluent builder for event templates. Chainable, immutable-ish, ergonomic.
import type { EventTemplate, NostrEvent, Tag } from './event.ts'

/**
 * Fluent template builder. Every method returns `this` so you can chain, and
 * the builder IS an `EventTemplate` (it has kind/tags/content), so you can pass
 * it straight to a signer without calling `.build()` — but `.build()` exists
 * for clarity.
 */
export class TemplateBuilder implements EventTemplate {
  kind: number
  tags: Tag[]
  content: string
  created_at?: number

  constructor(kind: number, content = '') {
    this.kind = kind
    this.content = content
    this.tags = []
  }

  /** Add a raw tag, e.g. `.tag('t', 'coffee')` or `.tag('e', id, relay, 'reply')`. */
  tag(...values: string[]): this {
    this.tags.push(values)
    return this
  }

  /** Add several tags at once. */
  addTags(tags: Tag[]): this {
    this.tags.push(...tags)
    return this
  }

  /** Set the content. */
  text(content: string): this {
    this.content = content
    return this
  }

  /** Pin the timestamp (otherwise the signer stamps "now"). */
  at(created_at: number): this {
    this.created_at = created_at
    return this
  }

  /** Reference a person (`p` tag) — used for mentions, DMs, follows. */
  mention(pubkey: string, relay?: string): this {
    return relay ? this.tag('p', pubkey, relay) : this.tag('p', pubkey)
  }

  /** Reply to an event with NIP-10 markers: roots the thread correctly. */
  replyTo(parent: Pick<NostrEvent, 'id' | 'pubkey' | 'tags'>, relay = ''): this {
    // carry the root from the parent's tags, else the parent becomes the root
    const root = parent.tags.find((t) => t[0] === 'e' && t[3] === 'root')?.[1]
    if (root) {
      this.tag('e', root, relay, 'root')
      this.tag('e', parent.id, relay, 'reply')
    } else {
      this.tag('e', parent.id, relay, 'root')
    }
    this.tag('p', parent.pubkey)
    return this
  }

  build(): EventTemplate {
    const template: EventTemplate = { kind: this.kind, tags: this.tags, content: this.content }
    if (this.created_at !== undefined) template.created_at = this.created_at
    return template
  }
}

/** Build any kind. */
export const build = (kind: number, content = ''): TemplateBuilder => new TemplateBuilder(kind, content)

/** Build a kind-1 text note. */
export const buildNote = (content = ''): TemplateBuilder => new TemplateBuilder(1, content)
