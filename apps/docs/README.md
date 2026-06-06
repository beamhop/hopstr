# @hopstr/docs

The Velvet documentation site — built with [Vocs](https://vocs.dev) (React + Vite),
with **live React islands that run the real library against real Nostr relays in the
browser**, Twoslash type-annotated examples, and an auto-generated TypeDoc API reference.

## Develop

```bash
bun run docs:dev        # vocs dev server at http://localhost:5173
bun run docs:build      # static build (runs Twoslash on every example)
bun run docs:api        # regenerate the API reference from package TSDoc
```

(From this package directly: `bun run dev` / `build` / `preview` / `api` / `check-examples`.)

## How it's structured

- `src/pages/*.mdx` — the guide + landing pages (Vocs file-based routing)
- `src/pages/api/generated/` — TypeDoc output (gitignored; run `bun run api`)
- `src/components/*.tsx` — the live islands (`HelloNostr`, `LiveFeed`) that import the
  published `@hopstr` packages and connect to public relays
- `vocs.config.ts` — site config; `typedoc.json` — API generation

## Why the examples can't lie

Every ` ```ts twoslash ` block is compiled by the real TypeScript compiler at build
time. If an example stops compiling against the current library, `docs:build` fails.
So the docs are guaranteed to match working code.

## Notes

- Pinned to `waku@1.0.0-beta.0` to match Vocs 2.0.12's RSC pipeline (newer betas
  changed an internal middleware contract and break the static build).
- This package is private and excluded from the Changesets release.
