# lingo site — lingo.pascal.app

The docs/marketing site for [`@pascal-app/lingo`](../../packages/lingo/README.md): **Make forms
easier, LLM tools safer.** Every demo runs the real library live (hero parser,
strictness lab, forms lab, server action, AI canonicalizer) — the site is the
dogfood.

- `/` — landing: hero universal input + bento demos.
- `/docs` — single-page docs with anchor nav (Parse, Strictness, Forms,
  For AI, Coverage, Integrations, Performance, API).
- `/llms.txt` — spec-compliant agent index (links to every section and tier).
- `/llms-full.txt` — complete docs narrative as markdown (`src/lib/docs.md.ts`).
- `/llms-small.txt` — compressed API reference synced from `packages/lingo/llms.txt`.
- `/docs/<section>.md` — per-topic markdown slices for coding agents.
- `/llms.md` — legacy full markdown export (compat).
- SEO/social: `metadataBase` + OpenGraph/Twitter cards (`src/app/opengraph-image.tsx`),
  `robots.ts`, `sitemap.ts`, JSON-LD on `/` and `/docs`.

## Commands

```bash
bun dev       # dev server on localhost:3000, auto-increments if busy (uses .next-dev)
bun kill      # stop the listener on port 3000 (pass a port: bun kill 3001)
bun clean     # remove .next, .next-dev, and .next-build
bun restart   # kill + clean + dev
bun run typecheck # tsgo 7 native TypeScript check
bun run build # tsgo typecheck + production build (use run; bun build is Bun's bundler)
bun run start # serve the production build (port 3000 by default)
bun run doctor # react-doctor audit
```

The dev port defaults to `3000`; when it's busy (other apps commonly use it)
Next picks the next free port and prints it — read the actual port from the
dev output. If CSS looks missing or stale, run `bun restart` from this
directory before debugging source.

The site consumes the library as a live workspace link — after changing
library source, `bun run build` in `packages/lingo` (or `bun dev` at the repo
root, which runs the watcher) is enough; `bun run site:sync` at the root also
refreshes `llms-small.txt` and bench/eval data.

Gotcha: link to `/llms.txt`, `/llms-full.txt`, and `/docs/*.md` with plain `<a>`, not `next/link` —
they are route handlers, and client-side navigation 404s on them.
