<!-- FORK BLOCK — ovurrsl/editor only. Upstream has no equivalent, so it
     conflicts on every merge. Keep this block, take upstream's body below it.
     The rule is recorded in UPSTREAM.md. -->

> ## ⚠️ You are in `ovurrsl/editor`, a fork. Read this before anything else.
>
> Everything below this block is upstream's own instructions, written for
> `pascalorg/editor`. They are accurate about the code and silent about this
> fork. These four facts are the ones that cause damage when unknown:
>
> 1. **The default branch is `integration`, and that is where you work.** It
>    carries ~130 commits upstream does not have, and the production bundle is
>    built from it.
> 2. **Never commit to `main`.** It is a byte-for-byte mirror of
>    `pascalorg/editor`, and being a pure mirror is the only reason taking
>    upstream never conflicts. `mirror-upstream` refuses to force over local
>    commits, so a commit here does not get erased — it jams the mirror until
>    somebody moves it by hand.
> 3. **Three things flow in here automatically** and you should not do their
>    work by hand: the warehouse plugin pin (`bump-plugin`, hourly), the console
>    from `ovurrsl/panel` (`pull-panel`, hourly), and upstream itself
>    (`mirror-upstream`, daily, which opens a pull request rather than merging).
> 4. **`apps/editor/panel/**` is vendored, not authored here.** Its home is
>    `ovurrsl/panel`. Editing it here is overwritten by the next hourly pull —
>    change it there instead.
>
> **`OTOMASYON.md`** is the whole picture in plain language: what runs when,
> which secret each workflow needs, and where to look when a link goes quiet.
> **`UPSTREAM.md`** is the per-file rule for merging upstream.
>
> One more, because it is invisible until it bites: **a push made with
> `GITHUB_TOKEN` starts no workflow runs.** Any workflow that pushes and expects
> a build must dispatch it explicitly.

<!-- END FORK BLOCK -->

# Agent Instructions — `pascalorg/editor`

Public, open-source home of `@pascal-app/{core,viewer,editor,mcp}` and the standalone editor app. Consumed both as npm packages and (in `pascalorg/private-editor`) as a git submodule.

## Repo Shape

| Path | Purpose |
|---|---|
| `packages/core` | Scene graph, node schemas, stores, event bus, core systems — pure logic, no Three.js |
| `packages/viewer` | Standalone 3D canvas: renderers, viewer systems, presentation state |
| `packages/editor` | Editor UI components reused by the standalone app and embedders |
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

## Operating rules

- Read the full file before editing. Plan all changes, then make one complete edit.
- When the user corrects you, stop and re-read their message.
- After two consecutive tool failures, stop and change approach.
- Don't introduce backwards-compatibility shims, dead code, or speculative abstractions.
- Don't write new comments unless they explain a non-obvious *why*.
