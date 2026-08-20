---
id: 021
title: MCP integration
status: in-progress
created: 2026-07-04
updated: 2026-07-07
---

# MCP integration — the fourth audience

Driver: the tagline serves humans, LLMs, API, **and MCP**. Nothing blocks MCP:
lingo fields already emit JSON Schema
(`field['~standard'].jsonSchema.input(...)`) and validate (`safeParse`), which
is the entire MCP tool contract. The gap was packaging and communication.

## Phase 1 — docs + recipes

As specified, shipped: `docs/recipes.md` carries the AI tool field recipe
(`quantityField`/`lingoObject` with the plan 020 safety defaults) and the MCP
tool recipe (inputSchema from
`lingoObject(...)['~standard'].jsonSchema.input({ target: 'draft-2020-12' })`,
`safeParse` in the handler, `[CODE]` issues returned as tool errors so the
model self-corrects); README "For AI" and llms.txt/`/llms.md` mention the MCP
pattern; `package.json` keywords include `mcp`.

## Phase 2 — `@pascal-app/lingo/mcp`

As specified, shipped (plan 024, D24): `lingoTool({ name, description, input:
shape, handler })` → `{ name, description, inputSchema, callback }` shaped for
`@modelcontextprotocol/sdk` `registerTool`, with lingo validation and
issue-to-tool-error mapping built in. Zero-dep (types only; the SDK stays the
consumer's); own tree-shakeable size budget in `scripts/size.mjs`.

## Phase 3 — demo MCP server (forward spec; optional, marketing + dogfood)

- `npx @pascal-app/lingo-mcp` (separate package or `examples/`): exposes
  `parse_quantity`, `convert`, `parse_date`, `humanize` as MCP tools. Doubles
  as a live demo that agents can call lingo directly.

## Open questions

- Whether the phase 3 demo server lives in the monorepo (`packages/mcp`) or a
  sibling package.
- Whether the demo server ships fixtures for MCP client conformance tests.
