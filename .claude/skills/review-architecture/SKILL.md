---
name: review-architecture
description: Review a PR against the Pascal architectural rules — layer boundaries (core/viewer/editor), systems/renderers/tools separation, hook hygiene (useEditor/useScene/useViewer), and selector performance. Use when the user asks to review a PR, audit a branch, or check that changes respect the codebase's architecture.
allowed-tools: Bash(git *) Bash(gh *) Read Grep Glob
---

Architectural review for Pascal PRs. The user will provide a PR URL, branch name, or ask to review the current branch.

## 1. Load the rules (required — do not skip)

Read these before reviewing any diff. They are the source of truth, not your training data:

- `.claude/rules/systems.md` — core systems vs viewer systems, what each may do
- `.claude/rules/renderers.md` — renderer responsibilities and prohibitions
- `.claude/rules/tools.md` — editor tools live only in `apps/editor/components/tools/`
- `.claude/rules/viewer-isolation.md` — viewer must stay editor-agnostic
- `.claude/rules/layers.md`
- `.claude/rules/selection-managers.md`
- `.claude/rules/scene-registry.md`
- `.claude/rules/spatial-queries.md`
- `.claude/rules/node-schemas.md`
- `.claude/rules/events.md`

Only the first four are required on every review; read the rest when the diff touches their subject area.

## 2. Fetch the diff

```bash
# If the user gave a PR URL or number:
gh pr diff <pr-number-or-url>

# If reviewing the current branch:
git diff main...HEAD
```

Also list changed files so you can map each to the relevant rule:

```bash
gh pr view <pr> --json files --jq '.files[].path'
# or
git diff --name-only main...HEAD
```

## 3. Layer classification — do this BEFORE the checklist

For every new file, new type, new store field, or new exported helper introduced by the diff, answer one question: **which layer does this belong to — core, viewer, or editor?** If the answer is "editor" but the code lives in `packages/core` or `packages/viewer` (or vice versa), flag it as a **blocker**. This is the most common and most damaging class of violation, and the checklist below won't reliably catch it on its own — do this pass explicitly.

### The three layers and what they own

**`packages/core` — domain data + pure logic.**
Owns: node schemas, the scene store (`useScene`), live transforms store, core systems (wall mitering, slab polygons, space detection), event bus, plain 2D/3D math helpers, `sceneRegistry`. Consumed by every downstream package, including read-only embeds. Must not know about: Three.js/R3F, `packages/viewer`, `apps/editor`, any rendering or UI concept, any tool/mode/phase concept, or any *view*-specific concept (floorplan, paint preview, cursor indicators, selection outline styling, etc.).

**`packages/viewer` — the 3D canvas, shippable standalone.**
Owns: `<Viewer>`, renderers, viewer systems (cutouts, zones, level positions, scans), the viewer store (`useViewer`) *for genuine presentation state only* (selection path, camera/level/wall/view modes, theme, display toggles, hover id). Consumed by both the editor and the read-only `/viewer/[id]` route. Must not know about: editor state (`useEditor`, tools, phases, modes), editor-only names baked into presentation modes (`'delete'`, `'paint-ready'`), editor-only state types (material preview, active paint target, floorplan anything).

**`apps/editor` (and editor-scoped packages) — the editing experience.**
Owns: tools, `useEditor`, action menus, panels, the floorplan panel and its helpers, paint mode, selection-manager phase/mode logic, cursor badges, command palette, keyboard shortcuts — anything absent from the read-only viewer route. Injects itself into `<Viewer>` via children and props, never the reverse.

### Five triggers that mean "this is probably editor"

1. **Would the read-only `/viewer/[id]` route need this?** If no, it belongs in `apps/editor`.
2. **Does the name contain an editor-specific word?** (`Floorplan`, `Paint…`, `Draft…`, `Marquee`, `CursorBadge`, `HoverMode`, `…Tool`, `Moving…`, `Curving…`.) Default to editor and justify loudly if it's anywhere else.
3. **Does the type or field reference a tool/mode/phase vocabulary?** (`'delete'`, `'paint-ready'`, `'material-paint'`, `'site'`/`'structure'`/`'furnish'`, `'build'`/`'edit'`.) Belongs in `useEditor`, not `useViewer` or core.
4. **Does the helper compute something only a 2D editor view needs?** (Floorplan transforms, measurement offsets, SVG path builders, marquee bounds scoped to floorplan.) Editor. Generic 2D geometry that any view could use (polygon math, rotation, clamping, line thickening) can live in core *as long as its names are generic* — no `Floorplan` prefix.
5. **Does a new store field have a setter that no part of the target layer ever calls?** (e.g. `setMaterialPreview` in `useViewer` that only the editor would ever invoke.) That's a layering smell — the state belongs in the caller's layer.

Write the classification down before writing findings. If core gains "Floorplan" types, or the viewer gains paint-mode vocabulary, or a renderer grows editor awareness — those are the blockers to lead with, not downstream symptoms.

## 4. Review checklist

### A. Layer boundaries
- `packages/viewer/**` does not import from `apps/editor` or reference `useEditor`, tool state, phase, or mode.
- `packages/core/**` does not import Three.js, react-three-fiber, or anything from `packages/viewer` / `apps/editor`.
- `packages/core/**` does not introduce types or helpers named after an editor view (`Floorplan*`, `Paint*`, `Draft*`). Generic plan-geometry helpers are fine; view-specific vocabulary is not.
- Renderers contain no geometry generation or domain logic — that belongs in a system.
- Tools mutate `useScene` (committed state) and `useLiveTransforms` (ephemeral drag state); direct `sceneRegistry` mesh transforms are allowed only under the live-drag exception in `.claude/rules/tools.md`. No business logic, no imports from `packages/viewer`.

### B. Hook hygiene (`useEditor`, `useScene`, `useViewer`)
- Stores hold state + setters only. No business logic, side effects, async work, or derived computations inside the store definition.
- Derived values belong in selectors or systems, not in the store body.
- No cross-store coupling: a store's action should not call another store's actions inside itself.
- New state added to `useViewer` must be presentation-only (selection, camera, level mode, display toggles). Editor-only state (active tool, phase, edit mode, paint preview, floorplan state) goes in `useEditor`.

### C. Selector performance
- Top-level components (pages, layouts, providers, `<Viewer>` siblings) must not subscribe to large or frequently-changing slices — e.g. `useScene(s => s.nodes)`, `useScene(s => s)`. Flag these: they re-render the whole subtree on every mutation.
- Selectors that return new object or array references each call (e.g. `s => ({ a: s.a, b: s.b })`, `s => s.items.filter(...)`) without a custom equality function (shallow or custom) are re-render hazards.
- Prefer subscribing by ID deep in the tree (one node per renderer) over subscribing to the full collection high up.

### D. Separation of concerns
- Viewer and core stay unaware of editor-specific concepts (tools, phases, active modes, editor UI state, view-specific helpers).
- Editor-only overlays and systems are injected as children of `<Viewer>`, not added inside the viewer package.
- New node types added correctly: schema → core system (if derived geometry) → viewer renderer → register in `NodeRenderer`.

## 5. Output format

Group findings by severity:

- **Blocker** — violates a rule in `.claude/rules` or breaks a layer boundary. Must be fixed before merge.
- **Suggestion** — likely problem, worth discussing. Not a hard block.
- **Nit** — minor, optional.

For each finding, include:

1. File and line: `path/to/file.ts:42`
2. The offending snippet (short — 1–5 lines)
3. The rule it violates, linked to the rule file (e.g. `.claude/rules/viewer-isolation.md`)
4. A concrete proposed fix

Skip formatting, import ordering, and anything CI already covers.

If the PR fully complies, say so explicitly — do not invent nits to appear thorough.

## 6. Final summary

End with:

- Blocker count, suggestion count, nit count
- One-sentence verdict: ready to merge / needs changes / needs discussion
- If blockers exist, list the files the author should open first
