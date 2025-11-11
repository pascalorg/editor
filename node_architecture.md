## Node architecture: rendering and editing in the editor and viewer

This document explains how the editor renders and alters building elements using a typed node tree, where and how interaction is handled, and how the same model powers the read‑only viewer.


### Mental model

- The canonical data model is a typed node tree. Each floor is a `level` node; building elements (walls, doors, windows, roofs, columns), reference assets (images, scans), and groups live as children of a level. Some nodes (e.g., doors/windows) are children of other elements (walls).
- Rendering is centralized in a single recursive renderer that dispatches by node type and renders children. Editing/manipulation is performed by specialized “builder” components per element type.
- `use-editor` is the single source of truth and event hub. It stores the node tree, derives a fast `nodeIndex` for O(1) lookups, exposes editing operations, manages modes/tools, and persists state (with heavy assets split out).
- The viewer reuses the same node tree and renderer but with read‑only UI and optional display filtering (e.g., scans‑only).


## Data model (types)

Defined in `lib/nodes/types.ts`. Key concepts:

- All nodes inherit from `BaseNode` and may have `children`, `parent`, `visible`, `opacity`, `locked`, and a `preview` flag for in‑progress placements.
- Grid‑aware nodes implement `GridItem` with `position: [x, y]` (grid units), `rotation` (radians), and `size: [width, depth]` (grid units). Grid units are 0.5m.
- `LevelNode` is a floor container. Its children can be building elements, groups, or reference nodes.
- `WallNode` additionally carries `start` and `end` grid points for the wall segment; doors and windows live under walls.


## Rendering pipeline

- Entry point: `components/editor/index.tsx` sets up the R3F `<Canvas>`, camera, lights, grids, and loops over visible `level` nodes, positioning them vertically (stacked vs. exploded). For the active floor, it mounts the relevant element builders (based on tool/mode), then renders the level subtree via `NodeRenderer`.
- `components/renderer/node-renderer.tsx`:
  - Converts grid to world coordinates (TILE_SIZE), applies `rotation`, respects `visible`/`opacity`.
  - Switches to a per‑type renderer: `WallRenderer`, `RoofRenderer`, `ColumnRenderer`, `DoorRenderer`, `WindowRenderer`, `ImageRenderer`, `ScanRenderer`, `GroupRenderer`.
  - Recursively renders `children`.
  - Draws a lightweight selection outline for grid items when selected.
  - In viewer mode, can filter nodes by `viewerDisplayMode` (e.g., show only `scan` or everything except `scan`).


## Editing/manipulation

Builders in `components/editor/elements/*-builder.tsx` implement interaction and commit changes through the store:

- Wall placement: two‑click flow with snapping and live preview.
  - Store methods: `startWallPreview(xy) → updateWallPreview(xy) → commitWallPreview()` or `cancelWallPreview()`.
  - Preview walls are real nodes with `preview: true`; they render like normal but are filtered from persistence.
- Doors/windows/columns/rooms/roofs: each has a dedicated builder that handles hover/click logic, computes placement (`position`, `rotation`, `size`), validates constraints (e.g., on‑wall placement for doors/windows), and calls generic node ops (`addNode`, `updateNode`, `deleteNode`).
- Grid interaction: a single interactive plane (`GridTiles`) emits normalized intersection events. The editor forwards `click`/`move` into builders and emits light events (`events/bus`) for decoupled features.
- Modes and tools:
  - Control modes: `select`, `delete`, `building`, `guide`.
  - Tools: `wall`, `room`, `custom-room`, `roof`, `column`, `door`, `window` (auto‑switches control mode to `building`).
  - Keyboard shortcuts: V/D/B/G for modes, C for camera, L for level layout, Z/Shift+Z for undo/redo, Esc to cancel placement.


## Store, state, and persistence (`hooks/use-editor.tsx`)

- Single source of truth:
  - `levels: LevelNode[]` — the node tree (canonical model).
  - `nodeIndex: Map<string, BaseNode>` — fast lookup rebuilt after every mutation.
  - Selections, current floor, modes (`controlMode`, `activeTool`, `cameraMode`, `levelMode`), and viewer display mode.
  - Undo/redo stacks of `levels` snapshots (max 50).
- Generic node operations: `addNode`, `updateNode`, `deleteNode`. Utilities to toggle visibility/opacity at any node id (including floors), get a node’s containing level, and import/export JSON.
- Preview lifecycle: preview nodes are added as regular nodes with `preview: true`; committing removes `preview` and pushes to undo; persistence filters out preview nodes.
- Persistence (IndexedDB):
  - Large asset URLs (`reference-image`, `scan`) are split into a separate key, while the structural tree stores placeholders `asset:<id>`. On load, assets are re‑injected.
  - This avoids rewriting multi‑MB payloads for small structural edits.
- Transitional helpers exist to bridge legacy flows (e.g., `setWalls`/`getWallsSet`) while everything moves fully node‑native. They preserve child elements (doors/windows) when regenerating walls.


## Grids, snapping, and interaction

- Base floor renders an infinite shader grid; upper floors render a proximity grid around content. Only the active floor exposes the interactive `GridTiles` for pointer events.
- Pointer snapping: hover/click project to horizontal, vertical, or 45° diagonals to keep clean plans (Sims‑style). Delete mode uses the same snapping to select segments to remove.
- Floors can be shown stacked (compact) or exploded (spaced out) with smooth spring animation; the active floor gets full interactivity and color, others are muted.


## Viewer mode

- The viewer reuses `NodeRenderer` in read‑only form. It can toggle between showing only scans or only 3D objects (walls, doors, etc.). Animated transitions, camera presets, and level focus are handled at the scene level; manipulation builders are not mounted.


## Motivation and technical choices

- Typed, hierarchical node model
  - Captures real‑world containment (doors/windows in walls, elements in floors) and enables clean invariants.
  - Makes constraints explicit and traversal efficient; simplifies export and selection.
- Declarative rendering with Three.js via React Three Fiber and Drei keeps scene code composable and testable.
- Zustand store
  - Minimal boilerplate, fast updates, and portable persistence.
  - `nodeIndex` enables O(1) by‑id and parent traversal in hot paths.
  - Snapshot‑based undo/redo is robust and easy to reason about.
- Preview‑node pattern gives immediate visual feedback and transactional commits without bespoke preview code per renderer.
- IndexedDB asset splitting keeps edits snappy even with large images/scans.


## Current limitations and known gaps

- Proximity grid still wires `components: []`; it should derive bounds directly from the node tree on non‑base levels.
- Selection outline is per‑node; a group/aggregate outline (e.g., for selected groups or nested selections) would improve UX.
- Only `nodeIndex` is maintained; optional richer indexes (by type/parent) are available in `lib/nodes/indexes.ts` but not fully leveraged in all render paths yet.
- Undo/redo uses level snapshots; structural diffs would reduce memory and enable more granular history.
- Geometric ops (wall joins/splits, precise miter recomputation, openings cutout) can be expanded further.
- Transitional APIs (`setWalls`, `getWallsSet`) remain for compatibility; fully node‑native flows are the goal.


## Where things live (quick map)

- Rendering entry: `components/editor/index.tsx` (Canvas, cameras, grids, floor loop, mounts builders, then `NodeRenderer`).
- Recursive renderer: `components/renderer/node-renderer.tsx` (type dispatch + recursion, selection outline, viewer filtering).
- Per‑type renderers: `components/renderer/*-renderer.tsx`.
- Interaction/builders: `components/editor/elements/*-builder.tsx` (manipulation logic per element type).
- Store and actions: `hooks/use-editor.tsx` (node ops, preview lifecycle, undo/redo, persistence, modes/tools).
- Types: `lib/nodes/types.ts` (all node shapes, unions, helpers).
- Indexes/utilities/operations: `lib/nodes/indexes.ts`, `lib/nodes/utils.ts`, `lib/nodes/operations.ts`.


## Extending the model

To add a new element type:

1) Define the node shape in `lib/nodes/types.ts` and update unions.
2) Implement guards/operations as needed (`lib/nodes/guards.ts`, `lib/nodes/operations.ts`).
3) Create a `*-renderer.tsx` for rendering and a `*-builder.tsx` if the element is user‑placeable.
4) Wire into `NodeRenderer` switch and mount the builder in `components/editor/index.tsx` (tool/mode‑gated).
5) If needed, extend persistence/indexes/selectors and viewer filtering.


— End —

