# Agent Instructions — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,mcp}` and the standalone editor app. Consumed both as npm packages and (in `pascalorg/private-editor`) as a git submodule.

## Repo Shape

| Path | Purpose |
|---|---|
| `packages/core` | Scene graph, node schemas, stores, event bus, core systems — pure logic, no Three.js |
| `packages/viewer` | Standalone 3D canvas: renderers, viewer systems, presentation state |
| `packages/editor` | Editor UI components reused by the standalone app and embedders |
| `packages/nodes` | Built-in node bundles — one folder per kind (schema, geometry, panels, solver) |
| `packages/mcp` | MCP server and scene storage adapters |
| `apps/editor` | Standalone editor app — composes `viewer` + `editor` + tools |

## Where to look

- **Architecture rules** — `wiki/architecture/` (read on demand; index in `wiki/architecture/README.md`).
- **Skills (ready workflows)** — `.agents/skills/<name>/SKILL.md`. Same content is reachable as `.claude/skills/`, `.cursor/skills/`, `.codex/skills/` (symlinks to `.agents/skills/`).
- **Repo orientation for humans** — `README.md`, `SETUP.md`, `CONTRIBUTING.md`.

`CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` are symlinks to this file. Codex reads this file directly.

## Layer Boundaries (read once, internalise)

- **`packages/core`** owns domain data and pure logic. It must not import Three.js, `packages/viewer`, `apps/editor`, rendering/UI concepts, tools, modes, phases, or view-specific concepts such as floorplan or paint preview.
- **`packages/viewer`** owns the standalone 3D canvas, renderers, viewer systems, and genuine presentation state. It must not know about `useEditor`, editor tools, phases, modes, paint mode, floorplan state, or editor-only presentation vocabulary.
- **`apps/editor`** owns the editing experience: tools, `useEditor`, panels, floorplan helpers, paint mode, keyboard shortcuts, command palette, action menus, cursor badges, and editor-only overlays. Editor features are injected into `<Viewer>` via props and children.

Details, examples, and rationale live in `wiki/architecture/layers.md`, `wiki/architecture/viewer-isolation.md`, `wiki/architecture/systems.md`, `wiki/architecture/renderers.md`, `wiki/architecture/tools.md`.

## When making architecture-sensitive changes

Read the relevant page in `wiki/architecture/` **before** writing code. The page list lives in `wiki/architecture/README.md`. As a minimum:

- Adding a node type → `node-schemas.md`, `renderers.md`, `systems.md`
- Adding a tool → `tools.md`, `spatial-queries.md`, `events.md`
- Adding / changing a placement or move interaction → `tools.md` ("2D ↔ 3D behavioral parity": applicable behaviors must exist in both views; port the change to the sibling 2D/3D file in the same PR)
- Adding a system → `systems.md`, `scene-registry.md`
- Anything in `packages/viewer` → `viewer-isolation.md`, `layers.md`
- Anything touching selection → `selection-managers.md`, `scene-registry.md`, `events.md`

## When reviewing a PR

Invoke the `review-architecture` skill (`.agents/skills/review-architecture/SKILL.md`). It loads the required architecture pages, fetches the diff, classifies each new file by layer, and reports findings grouped by severity.

## Before you call a change done

Run all four. `check-types` and `bun test` pass on code `next build` rejects, so the build is not redundant with them:

| Command | Catches |
|---|---|
| `bun run check-types` | Types across all packages |
| `bun test` | Behaviour |
| `bunx biome check --write` | Format and lint |
| `bun run build` | Server/client boundary violations, stale `dist/`, and file-tracing warnings |

Two consequences worth knowing before you write the code:

- **Cross-package tests read `dist/`, not `src/`.** `@pascal-app/*` resolves to compiled output, so a change in `packages/core` is invisible to a `packages/nodes` test until you build. `tooling/check-dist-parity.mjs` is the gate.
- **Anything reachable from `apps/editor/app/api/**/route.ts` is a Server Component.** A React client hook anywhere in that import graph fails `next build`. Reach pure functions through a narrow entry point (`@pascal-app/nodes/<kind>/headless`) rather than a barrel that also exports a panel; `apps/editor/lib/server-imports.test.ts` enforces this.
- **Read `next build`'s warnings, not just its errors.** "Encountered unexpected file in NFT list" means a `path.*` or `fs.*` call over a value the tracer cannot see through made it bundle the whole project into a route. Scope the path statically, or mark it `/*turbopackIgnore: true*/` when it genuinely points outside the project.

## Operating rules

- Read the full file before editing. Plan all changes, then make one complete edit.
- When the user corrects you, stop and re-read their message.
- After two consecutive tool failures, stop and change approach.
- Don't introduce backwards-compatibility shims, dead code, or speculative abstractions.
- Don't write new comments unless they explain a non-obvious *why*.
