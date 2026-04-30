# Pascal Agent Instructions

This repository uses shared architecture rules for AI assistants. Treat the rule files as the source of truth for architecture-sensitive work.

## Required Rule Sources

The canonical rules live in `.cursor/rules/*.mdc`.

Claude-compatible paths are exposed in `.claude/rules/*.md`.
Codex-compatible paths are exposed in `.codex/rules/*.md`.

Both should point to the same Cursor rule sources so Claude and Codex review the exact same rules.

## Architecture Rules

Read the relevant rules before making or reviewing changes in these areas:

- `.codex/rules/systems.md` — core systems vs viewer systems, what each may do
- `.codex/rules/renderers.md` — renderer responsibilities and prohibitions
- `.codex/rules/tools.md` — editor tools live only in `apps/editor/components/tools/`
- `.codex/rules/viewer-isolation.md` — viewer must stay editor-agnostic
- `.codex/rules/layers.md`
- `.codex/rules/selection-managers.md`
- `.codex/rules/scene-registry.md`
- `.codex/rules/spatial-queries.md`
- `.codex/rules/node-schemas.md`
- `.codex/rules/events.md`

For architecture reviews, the first four are always required. Read the remaining rules when the diff touches their subject area.

## Layer Boundaries

`packages/core` owns domain data and pure logic. It must not import Three.js, `packages/viewer`, `apps/editor`, rendering/UI concepts, tools, modes, phases, or view-specific concepts such as floorplan or paint preview.

`packages/viewer` owns the standalone 3D canvas, renderers, viewer systems, and genuine presentation state. It must not know about `useEditor`, editor tools, phases, modes, paint mode, floorplan state, or editor-only presentation vocabulary.

`apps/editor` owns the editing experience: tools, `useEditor`, panels, floorplan helpers, paint mode, keyboard shortcuts, command palette, action menus, cursor badges, and editor-only overlays. Editor features are injected into `<Viewer>` via props and children.

## Review Expectations

When reviewing architecture changes:

1. Classify every new file, type, store field, and exported helper as core, viewer, or editor before writing findings.
2. Lead with layer-boundary blockers.
3. Check hook hygiene for `useEditor`, `useScene`, and `useViewer`.
4. Check selector performance for broad subscriptions and selectors that allocate fresh references.
5. Skip formatting and import ordering unless they hide a real behavior or architecture issue.

Use `.codex/skills/review-architecture/SKILL.md` when the user asks Codex to review a PR, audit a branch, or check architecture compliance.
