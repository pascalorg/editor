---
id: 012
title: Agent & LLM friendliness
status: done
created: 2026-07-03
updated: 2026-07-23
---

# Agent & LLM friendliness

Agents are first-class consumers: an LLM filling a form should be able to write
natural language into any lingo field and read back canonical values — and a
coding agent should be able to learn the whole API from one file.

## Library affordances

- **Deterministic**: explicit `now`, no locale sniffing, stable JSON output
  (`toJSON()` documented, flat versioned v3 shape
  `{ schemaVersion: 3, type, kind, value, unit, base, baseUnit, ... }` with
  self-describing `{ start, end, text }` spans — plan 025/D57; `fromJSON`
  accepts it). Same input+options = same output, forever within a major.
- **Machine-readable results**: discriminated unions; `issues[].code` stable;
  `confidence` numeric; `alternatives` enumerable — an agent can act on ambiguity
  instead of guessing.
- **Imperative DOM API**: `field.set('5\'11"')` + `field.value` — automation never
  needs to simulate keystrokes; hidden canonical input means scraping a form gives
  clean data.
- **`data-lingo` attributes** advertise fields to agents ("this input accepts natural
  language of kind length, canonical unit m") — browser agents can discover
  capabilities from the DOM alone.

## llms.txt tiers

Two roles, split intentionally:

| Surface | Role |
|---------|------|
| `packages/lingo/llms.txt` (npm) | Self-contained compressed API reference with nested headings, fenced examples per entry (including `./react` and `./react-native` adapter recipes), issue-code remedies, and canonical input→output examples. Shipped in the tarball; also mirrored at `/llms-small.txt`. Agents must be able to integrate from this file alone when offline. |
| `https://lingo.pascal.app/llms.txt` | Spec-compliant index ([llmstxt.org](https://llmstxt.org/)): H1 + blockquote + H2 link lists to `/docs/<section>.md`, `/llms-full.txt`, schema artifacts, and an `## Optional` section. Generated from `docs-catalog.ts` at build time. |
| `/llms-full.txt` | Complete `/docs` narrative as markdown (from `docs.md.ts`). |
| `/docs/<section>.md` | Self-contained per-topic slices with context headers (Mintlify-style append-`.md` convention). Served by the `/docs-md/[slug]` route handler behind a `beforeFiles` rewrite, because the indexable HTML page below owns the `/docs/[slug]` segment. |
| `/docs/<section>` | Indexable HTML twin of each `.md` slice (SSG, own title/description/canonical, TechArticle + BreadcrumbList JSON-LD) — the search-engine counterpart to the agent markdown. |

Agent fetch order: index → section `.md` or full narrative → keep measurements as strings in tool schemas until lingo validates.

Maintenance: hand-edit the npm reference when public API changes; the site index is generated; CI gates the `Kinds:` line and index link integrity.

## Docs for agent builders

README section "For agents": recipe for form-filling (set → commit → read
canonical), recipe for parsing user free text server-side (lingo() with kind
whitelist), recipe for validating LLM tool-call arguments (schema: pass strings
through parseQuantity instead of asking the model for floats — models are better at
"2 ft" than at 0.6096).
