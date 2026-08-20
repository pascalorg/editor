---
id: 011
title: Packaging, DX & release
status: approved
created: 2026-07-03
updated: 2026-07-21
---

# Packaging, DX & release

## Package

- `@pascal-app/lingo`, MIT, `type: module`, dual ESM+CJS via tsup, `.d.ts` for every entry,
  `sideEffects: false`, `files: ["dist", "llms.txt", "CHANGELOG.md"]`, Node ≥ 18,
  no runtime deps, React optional peer (`./react` and `./react-native` only).
- Entries: `.`, `./core`, `./date`, `./describe`, `./catalog`, `./schema`,
  `./dom`, `./element`, `./react`, `./react-native`, `./complete`, `./ai`,
  `./mcp`, `./locales/*` (+ `./package.json`).
- `llms.txt` ships in the tarball as the offline agent reference (inline examples
  per entry); the site mirrors it at `/llms-small.txt`.
- The IIFE playground build (`demo/lingo.demo.js`, built by `scripts/demo.mjs`)
  is a repo-local artifact for the zero-build demo only — it is not part of
  `files`/`exports` and does not ship in the npm package (D16); CDN/`<script>`
  distribution off the package itself is deferred until requested.

## DX bar (the libphonenumber/date-fns lesson)

- **One import, one call**: `import { lingo } from '@pascal-app/lingo'; lingo('5\'11"')` —
  works with zero config. Progressive disclosure into options.
- Errors never throw on user input; results are discriminated unions narrowing on
  `.type`/`.ok` — autocomplete-driven usage.
- Every public symbol has TSDoc with @example that is copy-paste runnable.
- README leads with the form-field GIF scenario and a 10-line quickstart per layer
  (vanilla parse, convert, format, date, dom, react).
- `demo/index.html`: zero-build playground (loads the IIFE artifact) — parse box
  with live result JSON, form demo (meters-only field accepting anything),
  theming demo via data-attrs.

## Versioning & release

- 0.1.0 first publish (after adversarial review passes). SemVer strictly; parser
  *accepting more* = minor; changed interpretation of previously-valid input = MAJOR
  (interpretation changes are breaking!). Corpus diffs gate this in CI.
- CHANGELOG.md keep-a-changelog format.
- `prepublishOnly: bun run check`; publish is manual/user-approved.
- CI (`.github/workflows/ci.yml`): a full-gate job on a Node 20/24 matrix
  (lint on 24, typecheck, test, build, size, corpus gate, zero-deps gate,
  docs-sync gate, schema-artifacts gate, `npm pack --dry-run` preview); a
  node-support job that imports and smokes the built ESM+CJS dist on Node
  18/20/24 (the real ship-target check for the engines floor); a site build job.
- Release (`.github/workflows/release.yml`): manual `workflow_dispatch` with a
  patch/minor/major bump input — runs the full gate, bumps the version, promotes
  the CHANGELOG `[Unreleased]` section to a dated heading, publishes with
  `npm publish --provenance`, then commits, tags, and creates the GitHub release.

## Docs surfaces

README (hero + API tour), `wiki/` (as-built), TSDoc (IDE), llms.txt (plan 012),
demo page. API reference generated later (typedoc — post-0.1).
