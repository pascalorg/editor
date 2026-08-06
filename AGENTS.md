# Agent Instructions — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,mcp}` and the standalone editor app. Consumed both as npm packages and (in `pascalorg/private-editor`) as a git submodule.

## Repo Shape

| Path | Purpose |
|---|---|
| `packages/core` | Scene graph, node schemas, stores, event bus, core systems — pure logic, no Three.js |
| `packages/viewer` | Standalone 3D canvas: renderers, viewer systems, presentation state |
| `packages/editor` | Editor UI components reused by the standalone app and embedders |
| `packages/nodes` | Node kinds: one folder per kind (schema re-export, definition, geometry, floorplan, renderer, tool) |
| `packages/mcp` | MCP server and scene storage adapters |
| `apps/editor` | Standalone editor app — composes `viewer` + `editor` + tools |

Dependencies run **core → viewer → editor → nodes → apps**. `packages/nodes`
depends on `@pascal-app/editor`, so the editor package can never import
`nodes` — shared logic a node kind needs has to live in `editor` (or `core`)
and be imported from there.

## Where to look

- **Architecture rules** — `wiki/architecture/` (read on demand; index in `wiki/architecture/README.md`).
- **Skills (ready workflows)** — `.agents/skills/<name>/SKILL.md`. Same content is reachable as `.claude/skills/`, `.cursor/skills/`, `.codex/skills/` (symlinks to `.agents/skills/`).
- **Repo orientation for humans** — `README.md`, `SETUP.md`, `CONTRIBUTING.md`.

`CLAUDE.md`, `GEMINI.md`, and `.github/copilot-instructions.md` are symlinks to this file. Codex reads this file directly.

## Commands

Bun + Turborepo. From the repo root:

```sh
bun dev            # every app (editor :3002, ifc-converter :3003)
bun test           # all packages
bun check-types    # all packages that declare it
bun check          # biome lint + format (add :fix to write)
bun restart        # kill :3002, clear caches, dev
```

Narrow the loop while working:

```sh
cd packages/core && bun test src/services/snap.test.ts   # one file
bun test -t "merges collinear"                           # one test by name
bunx turbo run test --filter=@pascal-app/core            # one package
bunx turbo run test --force                              # ignore the turbo cache
cd packages/editor && bunx tsgo --noEmit                 # type-check one package
```

Three things that will mislead you if you don't know them:

- **`packages/nodes` has no `check-types` script.** Its type errors surface
  only through its `build`. `bun check-types` passing does not mean `nodes`
  compiles — run `bunx turbo run build` before believing types are clean.
- **`core`, `nodes` and `viewer` exclude `**/*.test.ts` from their tsconfigs**,
  so their tests are never type-checked. A test fixture can drift out of shape
  with the type it stands for and nothing complains. (`editor` and
  `cad-import` do check theirs.)
- **`turbo run test` depends on `^build`**, so a package tests against the last
  built `dist` of its dependencies. After editing a dependency, rebuild it or
  the consumer's tests run against stale code.

## Layer Boundaries (read once, internalise)

- **`packages/core`** owns domain data and pure logic. It must not import Three.js, `packages/viewer`, `apps/editor`, rendering/UI concepts, tools, modes, phases, or view-specific concepts such as floorplan or paint preview.
- **`packages/viewer`** owns the standalone 3D canvas, renderers, viewer systems, and genuine presentation state. It must not know about `useEditor`, editor tools, phases, modes, paint mode, floorplan state, or editor-only presentation vocabulary.
- **`apps/editor`** owns the editing experience: tools, `useEditor`, panels, floorplan helpers, paint mode, keyboard shortcuts, command palette, action menus, cursor badges, and editor-only overlays. Editor features are injected into `<Viewer>` via props and children.

Details, examples, and rationale live in `wiki/architecture/layers.md`, `wiki/architecture/viewer-isolation.md`, `wiki/architecture/systems.md`, `wiki/architecture/renderers.md`, `wiki/architecture/tools.md`.

## When making architecture-sensitive changes

Read the relevant page in `wiki/architecture/` **before** writing code. The page list lives in `wiki/architecture/README.md`. As a minimum:

- Adding a node type → `node-schemas.md`, `node-definitions.md`, `renderers.md`, `systems.md`. A kind is only fully registered once it exists in **four** places, and the compiler points at none of them until the last one is wrong:
  1. `packages/core/src/schema/nodes/<kind>.ts` — the zod schema
  2. `packages/core/src/schema/types.ts` — the `AnyNode` union, plus an export from `schema/index.ts`
  3. `packages/core/src/events/bus.ts` — a `NodeEvents<'<kind>', …>` entry. Miss this and the failure appears as an unrelated type error inside `packages/viewer`
  4. `packages/nodes/src/<kind>/` + its entry in `packages/nodes/src/index.ts`
- Adding a tool → `tools.md`, `spatial-queries.md`, `events.md`
- Adding / changing a placement or move interaction → `tools.md` ("2D ↔ 3D behavioral parity": applicable behaviors must exist in both views; port the change to the sibling 2D/3D file in the same PR)
- Adding a system → `systems.md`, `scene-registry.md`
- Anything in `packages/viewer` → `viewer-isolation.md`, `layers.md`
- Anything touching selection → `selection-managers.md`, `scene-registry.md`, `events.md`

## When reviewing a PR

Invoke the `review-architecture` skill (`.agents/skills/review-architecture/SKILL.md`). It loads the required architecture pages, fetches the diff, classifies each new file by layer, and reports findings grouped by severity.

## Operating rules

- Read the full file before editing. Plan all changes, then make one complete edit.
- When the user corrects you, stop and re-read their message.
- After two consecutive tool failures, stop and change approach.
- Don't introduce backwards-compatibility shims, dead code, or speculative abstractions.
- Don't write new comments unless they explain a non-obvious *why*.
