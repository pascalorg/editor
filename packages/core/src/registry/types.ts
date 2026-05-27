import type { ComponentType } from 'react'
import type { BufferGeometry, Object3D } from 'three'
import type { ZodObject, z } from 'zod'
import type { MaterialSchema } from '../schema/material'
import type { AnyNode, AnyNodeId } from '../schema/types'

// ─── GeometryContext ─────────────────────────────────────────────────
//
// Read-only scene access passed to `def.geometry(node, ctx)`. Most kinds'
// builders ignore `ctx` and read only `node` (shelf, item, spawn). Kinds
// whose meshes reference other nodes by ID — wall miters with siblings,
// door cutouts read parent wall — use `ctx` to resolve those references
// without importing `useScene`. Builders stay pure and unit-testable.
//
// Future extension: `levelData?: { miters?: ... }` for level-scoped batch
// data (wall mitering across an entire level). Decided alongside the wall
// migration off its dedicated system (Phase 3+).

export type GeometryContext = {
  /** Look up any node by ID. Returns undefined if the node doesn't exist. */
  resolve: <N = AnyNode>(id: AnyNodeId) => N | undefined
  /** Resolved children of this node (filters out unresolvable IDs). */
  children: AnyNode[]
  /** Same kind, same parent — drives wall mitering / endpoint-match. */
  siblings: AnyNode[]
  /** Resolved parent (null for root-level nodes). */
  parent: AnyNode | null
  /**
   * Pre-computed level-batch data, populated by the dispatcher when the
   * kind declares `def.computeLevelData`. Shared across every
   * `def.geometry(node, ctx)` call in the same level batch within a
   * single frame, so kinds whose geometry depends on cross-sibling
   * data (wall mitering, gradient sky uniforms across a zone, etc.)
   * don't pay an O(N²) recomputation cost.
   *
   * Typed as `unknown` at the framework boundary — kinds cast to their
   * own `LevelData` shape inside `def.geometry` (the same kind owns
   * both the `computeLevelData` return shape and the `geometry`
   * consumer, so the cast is internal). Only populated for `def.
   * geometry` calls today; not used by `def.floorplan` (which already
   * has cheap access to siblings through `ctx.siblings`).
   */
  levelData?: unknown
  /**
   * Optional view state — only populated for `def.floorplan` builders. The
   * 2D floor-plan layer surfaces selection / hover here so kinds can vary
   * their output (themed stroke when selected, endpoint dots when
   * selected, hatch overlay, hover-side highlight). For `def.geometry`
   * (3D) this is always undefined — the 3D selection outline is handled
   * by the merged-outline post-process pass instead.
   */
  viewState?: {
    selected: boolean
    /** Marquee or programmatic highlight — shows selected chrome without keyboard focus. */
    highlighted: boolean
    /** Pointer-hovered. */
    hovered: boolean
    /**
     * True while this node is the target of an active 2D move (i.e.
     * `useEditor.movingNode === node`). Used by kinds whose move
     * preview includes extra chrome — e.g. door / window emit
     * dimension lines showing the distance to adjacent openings or
     * wall ends only during the move.
     */
    moving: boolean
    /**
     * The kind's theme palette. Theme-aware colors (selection stroke,
     * endpoint handle fill, hatch color) live here so kinds don't need
     * to import `useViewer.theme` themselves.
     */
    palette: FloorplanPalette
  }
}

// ─── FloorplanPalette ────────────────────────────────────────────────
//
// Centralised set of themed colors that kinds pull from when building
// their floor-plan geometry. Mirrors the legacy `FloorplanPalette` in
// `floorplan-panel.tsx`. The 2D layer constructs this from
// `useViewer.theme` and passes it via `GeometryContext.viewState.palette`.

export type FloorplanPalette = {
  selectedStroke: string
  selectedFill: string
  /** Hatch / cross-stroke color used for selected fills with patterns. */
  selectedHatch: string
  /**
   * Stroke colour applied to a wall (and fence by analogy) when the
   * pointer hovers it. Light blue in the legacy palette — distinct from
   * the orange endpoint-handle hover so the body and its handles can
   * both glow independently. Pass through `viewState.palette.wall
   * HoverStroke` in `def.floorplan` when `viewState.hovered === true`
   * and the node isn't selected.
   */
  wallHoverStroke: string
  endpointHandleFill: string
  endpointHandleStroke: string
  endpointHandleHoverStroke: string
  endpointHandleActiveFill: string
  endpointHandleActiveStroke: string
  /**
   * Curve sagitta handle slot — distinct teal colour-set the legacy
   * `FloorplanWallCurveLayer` uses so users can tell endpoint dots
   * (orange) and curve dots (teal) apart at a glance.
   */
  curveHandleFill: string
  curveHandleStroke: string
  curveHandleHoverStroke: string
  measurementStroke: string
  measurementLabelBackground: string
  measurementLabelText: string
}

// ─── FloorplanGeometry ───────────────────────────────────────────────
//
// Output shape for `def.floorplan(node, ctx)`. The floor-plan panel
// converts these primitives to React-SVG elements via a generic renderer
// — kinds never touch SVG nodes directly. Coordinates are level-local
// meters; the panel handles world→SVG transform via its viewBox.
//
// Visual styling lives in the geometry so an AI-authored kind can pick
// its own colors without needing to know about CSS / theme tokens. The
// renderer maps these directly to SVG attributes.

export type FloorplanPoint = readonly [x: number, y: number]

export type FloorplanStyle = {
  stroke?: string
  fill?: string
  strokeWidth?: number
  strokeDasharray?: string
  opacity?: number
  /**
   * When `'non-scaling-stroke'`, the SVG renderer interprets `strokeWidth`
   * as a constant screen-pixel width regardless of viewport zoom. Maps
   * straight to the SVG `vector-effect` attribute. Default (undefined)
   * treats `strokeWidth` as plan-unit metres.
   *
   * Kinds that emit hand-drawn-looking strokes (fence body, wall hairlines,
   * post markers) want non-scaling so the visual weight stays stable as
   * the user zooms. Kinds whose stroke represents a real-world thickness
   * (wall body in floor plan, slab outline) leave it undefined.
   */
  vectorEffect?: 'non-scaling-stroke'
  strokeLinecap?: 'butt' | 'round' | 'square'
  strokeLinejoin?: 'miter' | 'round' | 'bevel'
  strokeOpacity?: number
  fillOpacity?: number
}

// ─── ToolHint ────────────────────────────────────────────────────────
//
// A single key + label entry in the contextual shortcut hint panel.
// `HelperManager` consults `def.toolHints` when the active tool matches
// a registered kind; matches the existing per-tool helper components
// today (e.g. WallHelper renders three of these entries).

export type ToolHint = {
  /** Key combo or input label, e.g. 'Left click', 'Shift', 'Esc'. */
  key: string
  /** Description of what the input does. Sentence case. */
  label: string
}

export type FloorplanGeometry =
  | ({ kind: 'path'; d: string } & FloorplanStyle)
  | ({ kind: 'polygon'; points: readonly FloorplanPoint[] } & FloorplanStyle)
  | ({
      kind: 'polyline'
      points: readonly FloorplanPoint[]
    } & FloorplanStyle)
  | ({
      kind: 'rect'
      x: number
      y: number
      width: number
      height: number
      rx?: number
      ry?: number
    } & FloorplanStyle)
  | ({ kind: 'circle'; cx: number; cy: number; r: number } & FloorplanStyle)
  | ({
      kind: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
    } & FloorplanStyle)
  /**
   * Plain SVG text in plan space. Used for short labels that need to
   * sit at a specific plan coordinate — e.g. the elevator served-level
   * chips' floor numbers. Rotates with the floor plan's transform
   * (same as polygon coordinates) so it shares the building's
   * orientation. For text that needs to stay screen-upright regardless
   * of plan rotation, use `dimension-label` instead (it auto-flips
   * upside-down labels).
   *
   * `fontSize` is in plan metres — typical values are 0.1–0.2m. The
   * registry layer doesn't apply any text-rendering chrome (no plate,
   * no rotation auto-flip) — it's just a styled `<text>` element.
   */
  | {
      kind: 'text'
      x: number
      y: number
      text: string
      fontSize: number
      fill?: string
      fontWeight?: number | string
      fontFamily?: string
      textAnchor?: 'start' | 'middle' | 'end'
      dominantBaseline?: 'auto' | 'middle' | 'central' | 'hanging' | 'alphabetic'
      opacity?: number
      /**
       * Outlined-text styling — when `stroke` is set the renderer applies
       * `stroke` / `strokeWidth` plus `paintOrder='stroke'` so the stroke
       * is drawn under the fill. Used by zone name labels for the
       * "white text inside a colored outline" look that stays legible
       * against any fill color.
       */
      stroke?: string
      strokeWidth?: number
      paintOrder?: 'stroke' | 'fill' | 'normal'
    }
  /**
   * Bitmap overlay — captured top-down asset thumbnail, AI-generated
   * floor-plan symbol, scan slice, etc. `url` is passed through the
   * editor's `loadAssetUrl` resolver (handles CDN / Supabase storage),
   * so kinds emit the raw `asset.floorPlanUrl` and don't worry about
   * fetching.
   *
   * `rotation` is in radians around `center`. The image is drawn at
   * `center` with size `width × height` in plan-local metres;
   * `preserveAspectRatio` controls letterboxing (default
   * `'xMidYMid meet'`).
   */
  | {
      kind: 'image'
      url: string
      center: FloorplanPoint
      width: number
      height: number
      rotation?: number
      preserveAspectRatio?: string
      opacity?: number
    }
  | {
      kind: 'group'
      children: FloorplanGeometry[]
      /** Optional transform applied to all children. Rotation in radians. */
      transform?: { translate?: FloorplanPoint; rotate?: number }
    }
  /**
   * Hatched fill overlay — same polygon shape as the kind's main fill but
   * stroked with diagonal lines on top. Used for the selected-wall hatch
   * effect from the legacy floor-plan panel. The 2D layer mounts a
   * shared `<pattern>` in `<defs>` and references it via `fill=url(...)`.
   */
  | { kind: 'hatch'; points: readonly FloorplanPoint[]; color: string; opacity?: number }
  /**
   * Transparent click-detection segment. Sits on top of the kind's main
   * geometry with a wide stroke so the user doesn't need to pixel-hunt
   * the polygon. `select` is the only affordance for now — clicking
   * triggers selection of the owning node.
   */
  | {
      kind: 'hit-line'
      x1: number
      y1: number
      x2: number
      y2: number
      /** Stroke width in screen pixels — converted to plan units by the dispatcher. */
      strokeWidthPx: number
      cursor?: string
    }
  /**
   * Endpoint manipulation handle — the 5-circle stack from the legacy
   * floor-plan: outer hover glow ring + hover ring + filled outer +
   * inner dot + transparent hit. Rendered with theme-aware colors from
   * `viewState.palette`. `affordance` keys into a kind-owned drag flow
   * the dispatcher invokes; `payload` is opaque kind data the
   * affordance handler unpacks.
   */
  | {
      kind: 'endpoint-handle'
      point: FloorplanPoint
      /** `active` = currently being dragged; `idle` = visible but inert. */
      state: 'idle' | 'active'
      /**
       * Visual colour-set. `'endpoint'` (default) → orange — wall /
       * fence endpoints, polygon vertices. `'curve'` → teal — the
       * sagitta midpoint handle. Other values are reserved for future
       * affordances (rotation, scale) without expanding the union.
       */
      variant?: 'endpoint' | 'curve'
      affordance: string
      payload: unknown
    }
  /**
   * Smaller "insert here" handle drawn between two polygon vertices.
   * Visually a small white dot with a `+` icon; hover-expanded. Triggers
   * an affordance that typically inserts a new vertex at the midpoint
   * and then drags it (matches the legacy slab / ceiling boundary
   * editor's edge-midpoint behaviour).
   */
  | {
      kind: 'midpoint-handle'
      point: FloorplanPoint
      affordance: string
      payload: unknown
    }
  /**
   * Hit-target along an entire polygon edge. Renders as a transparent
   * wide stroke for click detection; the dispatcher overlays a glow +
   * solid stroke when hovered or actively being dragged. Used by the
   * slab / ceiling boundary editor's "drag whole edge perpendicular"
   * affordance — both endpoints translate together along the edge
   * normal.
   */
  | {
      kind: 'edge-handle'
      x1: number
      y1: number
      x2: number
      y2: number
      affordance: string
      payload: unknown
    }
  /**
   * "Grab to move" handle drawn at a node's centroid — the orange dot
   * users click-and-drag to move a door / window / item in the
   * floorplan without going through the inspector's Move button.
   *
   * Pointer-down on the handle sets `useEditor.movingNode` to the
   * owning node, which `FloorplanRegistryMoveOverlay` picks up and
   * routes through the kind's `def.floorplanMoveTarget`. So both
   * entry points (Move button + dot grab) share the same move
   * pipeline — no parallel kind-side logic.
   */
  | {
      kind: 'move-handle'
      point: FloorplanPoint
    }
  /**
   * Centered length / distance label. Renders as a small rounded
   * background plate with text, oriented along `angle` (radians). The
   * 2D layer flips the label upright when it would otherwise be upside
   * down. Use this for simple "what length am I?" badges (fence, item
   * width, draft preview).
   */
  | {
      kind: 'dimension-label'
      cx: number
      cy: number
      text: string
      /** Rotation in radians. The renderer auto-flips to keep text upright. */
      angle: number
    }
  /**
   * Architect's dimension overlay — extension lines from the edge
   * endpoints out past the dimension line, two dimension line halves
   * with the label sitting in the gap, end ticks perpendicular to the
   * line. Used for the selected wall's full measurement; the rounded
   * plate label is the wrong shape when you want plan-drawing chrome.
   *
   * The renderer computes the segment geometry from these inputs so the
   * kind only needs to know "where is the edge and which way does the
   * dimension line offset." `offsetNormal` is a unit vector
   * perpendicular to the edge; pass the *outward* normal so the line
   * sits on the side facing away from the wall interior.
   */
  | {
      kind: 'dimension'
      start: FloorplanPoint
      end: FloorplanPoint
      /** Outward-pointing unit normal — the dimension line offsets along this. */
      offsetNormal: FloorplanPoint
      /** Distance (plan units) from the edge to the dimension line. */
      offsetDistance: number
      /** How far past the offset point the extension line continues. */
      extensionOvershoot: number
      text: string
      /** Optional override for the line/text colour. Defaults to the palette accent. */
      stroke?: string
    }

// ─── FloorplanAffordance ─────────────────────────────────────────────
//
// 2D drag session contract for floor-plan interactions. The registry
// layer (`FloorplanRegistryLayer`) drives the SVG event plumbing; each
// affordance handler owns the actual mutation logic for its kind.
//
// Lifecycle:
//   1. Pointer-down on a handle whose `affordance` key matches.
//   2. Layer captures node snapshots for `affectedIds` and pauses
//      history.
//   3. Layer calls `apply` on every pointer-move with the current plan
//      point + modifier keys.
//   4. On pointer-up: layer reads the resulting scene state, reverts to
//      the snapshot (still paused, untracked), resumes history, then
//      re-applies the final state as a single tracked change (single-
//      undo dance — same shape as Stage D 3D moves).
//   5. On pointer-cancel / unmount: revert + resume without committing.
//
// `apply` is expected to call `scene.updateNodes` directly to drive
// previews — the layer doesn't keep a separate draft state.

export type FloorplanAffordancePoint = readonly [x: number, y: number]

export type FloorplanAffordanceModifiers = {
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

export type FloorplanAffordanceSession = {
  /** Node IDs the drag may mutate. Used by the dispatcher for the snapshot. */
  affectedIds: AnyNodeId[]
  /**
   * Run a single drag tick. Implementations call `scene.updateNodes` to
   * preview the next position. Snap logic, linked-node cascade, and
   * angle locking live here.
   */
  apply(args: {
    planPoint: FloorplanAffordancePoint
    modifiers: FloorplanAffordanceModifiers
  }): void
  /**
   * Called on pointer-up. Return `true` if the scene's current state
   * should be committed; `false` reverts to the snapshot (e.g. wall too
   * short, vertex collapsed onto neighbour).
   */
  canCommit(): boolean
}

export type FloorplanAffordance<N> = {
  start(args: {
    node: N
    /** Opaque kind-specific payload from the handle primitive. */
    payload: unknown
    /** Current scene snapshot at drag start. */
    nodes: Record<AnyNodeId, AnyNode>
    /** Initial pointer position in plan coordinates. */
    initialPlanPoint: FloorplanAffordancePoint
  }): FloorplanAffordanceSession
}

// ─── FloorplanMoveTarget ─────────────────────────────────────────────
//
// Kind-specific 2D move-on-floorplan handler. Distinct from
// `FloorplanAffordance` because the lifecycle is different:
//
//   - `FloorplanAffordance` is **handle-driven** — the user pointer-downs
//     on a specific handle (endpoint dot, vertex, edge), drags, releases.
//     Has an `initialPlanPoint`. One drag = one session.
//   - `FloorplanMoveTarget` is **movingNode-driven** — the user clicks
//     "Move" in the inspector / action menu, the floor-plan tracks the
//     cursor from that moment until pointer-up or Esc. No initial
//     pointer-down. The session starts when `useEditor.movingNode` is
//     set to a node whose kind exposes `floorplanMoveTarget`.
//
// Usage:
//
//   - door / window: pointer must hit a wall in plan space; commit
//     re-anchors to the new wall (parentId + wallId + local position +
//     side + rotation). Reuses `door-math` / `window-math` clamp +
//     overlap helpers.
//   - item with `attachTo: 'wall'` / `'wall-side'`: same as door /
//     window but the local Y is free (item can move up/down the wall).
//   - item with `attachTo: 'ceiling'`: hit-test ceiling polygons,
//     reparent on transition.
//   - item with `attachTo: 'floor'` (or no attachTo): point-in-slab
//     check, snap to slab elevation.
//
// Falls back to `FloorplanRegistryMoveOverlay`'s generic free-floating
// translate when `floorplanMoveTarget` is unset on the kind.

export type FloorplanMoveTargetSession = {
  /** Node IDs the move may mutate. Used by the dispatcher for snapshot capture. */
  affectedIds: AnyNodeId[]
  /**
   * Single move-preview tick. Implementations call `scene.updateNodes`
   * directly to drive the live preview (no separate draft state).
   */
  apply(args: {
    planPoint: FloorplanAffordancePoint
    modifiers: FloorplanAffordanceModifiers
  }): void
  /**
   * Called on pointer-up. Return `true` to commit the current scene
   * state; `false` reverts to the snapshot (e.g. dropped in invalid
   * area, overlap detected, ...).
   */
  canCommit(): boolean
}

export type FloorplanMoveTarget<N> = (args: {
  node: N
  nodes: Record<AnyNodeId, AnyNode>
}) => FloorplanMoveTargetSession

// ─── Plugin manifest ─────────────────────────────────────────────────

export type Plugin = {
  id: string
  apiVersion: 1
  nodes?: AnyNodeDefinition[]
}

// ─── NodeDefinition ──────────────────────────────────────────────────

export type AnyNodeDefinition = NodeDefinition<ZodObject<any>>

export type SurfaceRole =
  | 'wall'
  | 'floor'
  | 'ceiling'
  | 'roof'
  | 'joinery'
  | 'glazing'
  | 'furnishing'

export type NodeDefinition<S extends ZodObject<any>> = {
  kind: string
  schemaVersion: number
  schema: S
  category: NodeCategory
  surfaceRole?: SurfaceRole

  defaults: () => Omit<z.infer<S>, 'id' | 'type'>
  migrate?: Record<number, (old: unknown) => unknown>

  capabilities: Capabilities
  relations?: Relations
  parametrics?: ParametricDescriptor<z.infer<S>>

  /**
   * Renderer for this kind. Optional under the three-checkbox composition
   * model (see `wiki/architecture/node-definitions.md`): when omitted, the
   * framework mounts a generic empty-group renderer that the per-kind
   * geometry/system fills. Required today only because the generic
   * renderer is not yet implemented — Phase 4 lands it, then this field
   * becomes truly optional at runtime too. Making the type optional now so
   * milestone-A skeletons (like wall) can compile before their runtime
   * port; downstream consumers (`<NodeRenderer>`, `RegisteredSystems`)
   * already null-guard on `def.renderer` so omitting it is safe.
   */
  renderer?: RendererSource<z.infer<S>>
  /**
   * Pure geometry builder. When set, the framework's generic
   * `<GeometrySystem>` calls this on every dirty mark — `nodes` keyed by
   * `def.geometry`'s presence are picked up; the returned `Object3D`'s
   * children replace the registered group's children. Together with
   * `<ParametricNodeRenderer>` this lets a kind ship without per-kind
   * `renderer.tsx` or `system.tsx` files (see
   * `wiki/architecture/node-definitions.md`). Combine with `renderer` if
   * you want JSX-side composition (drei, `<Html>`, GLB) AND parametric
   * rebuilds; combine with `system` if you also need per-frame imperative
   * work (animations, named-mesh material poking).
   */
  geometry?: (node: z.infer<S>, ctx: GeometryContext) => Object3D
  /**
   * Level-batch precompute hook. Called by `<GeometrySystem>` once per
   * level per frame, **before** the per-node `def.geometry` calls in
   * that batch. The result lands in `ctx.levelData` for every node in
   * the same level.
   *
   * Used by kinds whose geometry depends on cross-sibling data that
   * would be O(N²) to recompute per node:
   *   - wall: `calculateLevelMiters(walls)` — every wall's mesh
   *     reads its junctions from the level-wide miter graph.
   *   - zone (planned): shared TSL gradient uniforms.
   *
   * `siblings` is every node of this kind in the same level (including
   * the dirty ones). The dispatcher de-duplicates per level so this
   * runs once even when many walls are dirty in the same frame.
   */
  computeLevelData?: (siblings: ReadonlyArray<z.infer<S>>) => unknown
  /**
   * Pure 2D builder for floor-plan rendering. Mirrors `geometry` but emits
   * plain `FloorplanGeometry` data (SVG-renderable) rather than three.js
   * Object3D. Coordinates are level-local meters — the floor-plan panel
   * applies the world→SVG transform.
   *
   * Returns `null` when the kind shouldn't appear in floor plan (e.g. an
   * invisible utility node, or a kind that's 3D-only). Kinds that need
   * floor-plan rendering but no 3D mesh set `floorplan` without `geometry`.
   *
   * See `wiki/architecture/node-definitions.md` ("floor-plan rendering"
   * section) and Phase 5 of the registry plan for the migration plan off
   * the legacy `floorplan-panel.tsx` monolith.
   */
  floorplan?: (node: z.infer<S>, ctx: GeometryContext) => FloorplanGeometry | null
  /**
   * 2D drag affordances keyed by the string identifier emitted on
   * `endpoint-handle` (and similar interactive floor-plan primitives) via
   * the `affordance` field. The floor-plan registry layer calls
   * `def.floorplanAffordances?.[affordance].start({...})` on pointer-down,
   * receives a session, calls `apply(...)` on pointer-move and
   * `commit()` / `cancel()` on pointer-up / pointer-cancel. The session
   * mutates scene state directly during `apply`; the dispatcher handles
   * the snapshot + single-undo dance around it.
   *
   * Mirrors the existing 3D `affordanceTools` map but for 2D SVG events,
   * and operates on plain JS data instead of mounting React. Kinds with
   * both 3D and 2D affordances expose both fields — they're independent.
   */
  floorplanAffordances?: Record<string, FloorplanAffordance<z.infer<S>>>
  /**
   * Kind-specific 2D move handler for `useEditor.movingNode`-driven
   * placement in the floor plan. When set, `FloorplanRegistryMove
   * Overlay` invokes this once when `movingNode` becomes a node of
   * this kind, and drives the session through pointer events until
   * pointer-up / Esc. Falls back to the generic free-floating
   * translate when unset.
   *
   * Use this for kinds whose move semantics are anchor-aware:
   * doors / windows need wall hits + reparenting; items with
   * `attachTo` need parent-surface hits. Kinds with simple
   * translate-on-XZ semantics (shelf, spawn, fence) leave this
   * unset and rely on the generic overlay path.
   */
  floorplanMoveTarget?: FloorplanMoveTarget<z.infer<S>>
  system?: SystemContribution
  tool?: LazyComponent
  /**
   * Stage-D drag-affordance components — one per kind-owned editor mode
   * triggered by `useEditor` state. Component receives `{ node }` as its
   * sole prop. Lazy-loaded by ToolManager when the corresponding editor
   * state activates (e.g. `curvingFence` → `affordanceTools.curve`).
   *
   * Each component is the thin React wrapper around a pure DragAction
   * primitive that lives in the kind's `actions/` folder. The split keeps
   * the action data unit-testable while letting the wrapper consume
   * `useDragAction` + cursor visuals.
   *
   * Generic record so per-kind state names don't need to land in the
   * core type system. ToolManager looks up by string key.
   */
  affordanceTools?: Record<string, () => Promise<{ default: ComponentType<any> }>>
  affordances?: Affordance<z.infer<S>>[]
  /**
   * Contextual shortcut hints shown by `HelperManager` when this kind's
   * tool is active. Pure data — `HelperManager` renders these via a
   * generic <RegisteredToolHelper>. Drops the need for a hand-written
   * `<XxxHelper>` component per kind.
   *
   * Static array for now (covers ~all current uses). If a kind needs
   * state-dependent hints (e.g. different keys during a drag), it keeps
   * its bespoke helper component instead.
   */
  toolHints?: ToolHint[]

  /**
   * Optional translucent preview of the node — used by the move tool to
   * show where the node will land, and by the placement tool's cursor.
   * Receives the partially-resolved node (or a default-shaped stub during
   * placement before any commit has happened). Phase 4 may merge this with
   * the renderer behind an `opacity` prop.
   */
  preview?: () => Promise<{ default: ComponentType<{ node: z.infer<S> }> }>

  presentation?: Presentation
  mcp?: McpOverrides

  /**
   * Optional keyboard shortcut handlers contributed by the kind. The
   * editor's keyboard hook looks these up by event name (`r` for R /
   * Shift+R, `t` for T / Shift+T) and runs the matching handler when
   * the user presses that key with a single node of this kind
   * selected. The fallback rotation behaviour kicks in only when the
   * action's `appliesTo` returns false.
   *
   * Replaces editor-side per-kind switches in `use-keyboard.ts` — a
   * kind that wants to override R / T just sets this field instead of
   * extending a hand-written `if/else` chain. Door / window are
   * legacy direct calls today (follow-up: migrate them under this
   * capability too).
   */
  keyboardActions?: KeyboardActions
}

export type NodeCategory = 'site' | 'structure' | 'furnish' | 'analysis' | 'utility'

// ─── Keyboard actions ────────────────────────────────────────────────

export type KeyboardActions = {
  /** R / Shift+R primary action. */
  r?: KeyboardAction
  /** T / Shift+T secondary action. */
  t?: KeyboardAction
}

export type KeyboardAction = {
  /**
   * Predicate that gates the action. Return `false` when the
   * keystroke should fall through to the editor's default behaviour
   * for this kind (typically rotation). Skylight uses this to short-
   * circuit the action for non-operable type variants.
   */
  appliesTo: (node: AnyNode) => boolean
  /**
   * Run the action. The editor handles `preventDefault` and the
   * shared sfx — the handler should only touch scene / interactive
   * state.
   */
  run: (node: AnyNode) => void
}

// ─── Presentation (tool palette + UI surface) ────────────────────────

/**
 * UI metadata for surfacing a node kind in the tool palette and elsewhere.
 * Phase 4 ships the consumer (auto-derived palette buttons); definitions can
 * declare this from Phase 2 onward so the spike's `column` and `shelf` show up
 * correctly the moment the palette consumes the registry.
 */
export type Presentation = {
  /** Sentence-case label shown in palette buttons, breadcrumbs, etc. */
  label: string
  /** Optional longer tooltip / help text. */
  description?: string
  /** Icon for palette buttons and tree views. */
  icon: IconRef
  /** Tool palette section. Defaults to `category` when omitted. */
  paletteSection?: 'site' | 'structure' | 'furnish'
  /** Sort key within a palette section; lower numbers come first. */
  paletteOrder?: number
  /** Set true for kinds that exist but should NOT appear in the palette
   * (containers like `site`/`building`/`level`, internal nodes). */
  hidden?: boolean
}

export type IconRef =
  /** Iconify identifier, e.g. `lucide:square`. Matches the @iconify-react
   * setup the editor app already uses for tool icons. */
  | { kind: 'iconify'; name: string }
  /** URL path to a raster or vector asset (PNG/SVG/...). Matches the
   * palette's PNG/SVG assets — use this to share the same artwork
   * between the bottom toolbar and the inspector title. */
  | { kind: 'url'; src: string }
  /** Inline SVG path data. Use for asset packs or plugins that want a custom
   * mark without contributing a React component. */
  | { kind: 'svg'; viewBox: string; path: string }
  /** Custom React component, lazy-loaded. Use sparingly — adds a Suspense
   * boundary per icon. */
  | { kind: 'component'; module: () => Promise<{ default: ComponentType }> }

export type LazyComponent = () => Promise<{ default: ComponentType }>

export type RendererSource<N> =
  | {
      kind: 'parametric'
      module: () => Promise<{ default: ComponentType<{ node: N }> }>
    }
  | { kind: 'glb'; getAsset: (n: N) => AssetRef }
  | { kind: 'instanced-glb'; getAsset: (n: N) => AssetRef }

export type AssetRef = {
  id: string
  src: string
}

export type SystemContribution = {
  module: () => Promise<{ default: ComponentType }>
  priority?: number
}

export type McpOverrides = {
  description?: string
  semantic?: boolean
}

// ─── Capabilities ────────────────────────────────────────────────────

export type Capabilities = {
  movable?: MovableConfig
  rotatable?: RotatableConfig
  scalable?: ScalableConfig
  hostable?: HostableConfig
  cuttable?: CuttableConfig
  snappable?: SnappableConfig
  surfaces?: SurfacesConfig
  duplicable?: boolean
  deletable?: boolean
  groupable?: boolean
  selectable?: SelectableConfig
  interactive?: boolean
  floorPlaced?: FloorPlacedConfig
  roofAccessory?: RoofAccessoryConfig
  paint?: PaintCapability
}

/**
 * Per-kind paint behaviour. Lets the editor's selection-manager
 * route paint hover / click / preview through a generic dispatcher
 * instead of adding an `if (node.type === '<kind>')` arm for every
 * paintable kind.
 *
 * The capability owns the four kind-specific decisions:
 *   1. Which logical surface (`role`) the click landed on.
 *   2. The patch to commit on click.
 *   3. How to apply a preview material to the registered mesh
 *      subtree for that role (which mesh, which slot).
 *   4. How to read the currently-effective material for a role —
 *      drives the color picker's "current value" indicator.
 *
 * The editor still owns the visual chrome — hover/cursor styling,
 * the `selectedMaterialTarget` round-trip, the paint-mode toolbar.
 * Kinds with no paint behaviour omit `paint`.
 */
export type PaintCapability = {
  /**
   * Resolve which logical surface the user clicked. Returns `null`
   * when the face shouldn't be painted (e.g. interior slot exposed
   * by accident, normal too oblique for an unambiguous side).
   */
  resolveRole: (args: PaintResolveArgs) => string | null
  /**
   * Build the node-update patch that applies the new material at
   * `role`. Returned partial is merged into the node by the editor.
   */
  buildPatch: (args: PaintPatchArgs) => Partial<AnyNode>
  /**
   * Apply a preview to the kind's registered mesh subtree at
   * `role`. The kind builds whatever preview material(s) it needs
   * (single material, full material array, multi-slot patch — all
   * up to the kind) and swaps them in. Returns a cleanup callback
   * that restores the original assignments; the editor calls it
   * when the preview ends (hover changes, paint commits, paint
   * cancels).
   *
   * Returning `null` means the kind couldn't preview at this role
   * (typically because the registered mesh isn't mounted yet); the
   * editor falls back to the "not-allowed" cursor.
   */
  applyPreview: (args: PaintPreviewArgs) => (() => void) | null
  /**
   * Read the currently-effective material for `role` on `node`,
   * after walking any parent-fallback chain (segment → parent roof,
   * etc.). Powers `resolveActivePaintMaterialFromSelection` — when
   * the user has a paint target selected, the editor uses this to
   * show the role's current value in the picker.
   *
   * Returns `null` when the role doesn't apply to this kind.
   */
  getEffectiveMaterial?: (args: PaintEffectiveMaterialArgs) => {
    material: MaterialSchema | undefined
    materialPreset: string | undefined
  } | null
}

export type PaintResolveArgs = {
  node: AnyNode
  /**
   * The geometry's material-slot index resolved from the pointer
   * hit (via three.js groups). `null` when no group covers the
   * face.
   */
  materialIndex: number | null
  /** Optional: hit surface normal. Wall uses this for its interior/exterior split. */
  normal?: readonly [number, number, number]
  /** Optional: hit local position. Wall uses this to confirm the side. */
  localPosition?: readonly [number, number, number]
  /** Optional: name of the three.js object that received the hit. Stair uses this. */
  hitObjectName?: string
}

export type PaintPatchArgs = {
  node: AnyNode
  role: string
  material: MaterialSchema | undefined
  materialPreset: string | undefined
}

export type PaintPreviewArgs = {
  node: AnyNode
  role: string
  material: MaterialSchema | undefined
  materialPreset: string | undefined
  root: Object3D
}

export type PaintEffectiveMaterialArgs = {
  node: AnyNode
  role: string
  /** Snapshot of the scene `nodes` map — kinds whose effective material walks the parent chain (roof-segment → roof) read parents through it. */
  nodes: Record<AnyNodeId, AnyNode>
}

/**
 * Kinds mounted on a roof segment via `roofSegmentId`. Presence of this
 * capability tells the viewer's roof-merge loop two things:
 *
 *   1. **Dirty cascade.** When the accessory is dirtied (move / resize /
 *      reparent), the host segment's parent roof needs a re-merge —
 *      otherwise the merged shell shows the previous cut shape. The
 *      generic loop clears the accessory's dirty bit and queues the
 *      parent roof.
 *   2. **Optional CSG cut.** When `buildCut` is set, the merge loop
 *      subtracts the returned geometry from the host segment's shin /
 *      deck / wall brushes so the accessory has a clean hole to poke
 *      through. Returned geometry is SEGMENT-LOCAL; the viewer welds
 *      vertices, attaches a single material group, and wraps it in a
 *      `three-bvh-csg` Brush — core stays free of three-bvh-csg deps
 *      and kinds don't need to import it.
 *
 * Use `buildCut` when the kind pokes THROUGH the roof (skylight,
 * dormer). Kinds that sit ON TOP (vents, solar panels) declare the
 * capability without `buildCut` — the cascade still fires but no CSG
 * cut runs.
 */
export type RoofAccessoryConfig = {
  buildCut?: (node: AnyNode, hostSegment: AnyNode) => BufferGeometry | null
}

export type CapabilityCtx = { node: AnyNode }

export type MovableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  gridSnap?: boolean
  override?: (ctx: CapabilityCtx) => MovableConfig | null
}

export type RotatableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  snapAngles?: readonly number[]
  override?: (ctx: CapabilityCtx) => RotatableConfig | null
}

export type ScalableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  min?: number
  max?: number
  override?: (ctx: CapabilityCtx) => ScalableConfig | null
}

export type HostableConfig = {
  parents: readonly string[]
  align?: 'top' | 'bottom' | 'center' | 'face'
  fromAsset?: 'attachTo'
  modes?: Record<string, Partial<HostableConfig>>
  override?: (ctx: CapabilityCtx) => HostableConfig | null
}

export type CuttableConfig = {
  hostKinds: readonly string[]
  override?: (ctx: CapabilityCtx) => CuttableConfig | null
}

export type SnappableConfig = {
  points?: readonly SnapPointKind[]
  override?: (ctx: CapabilityCtx) => SnappableConfig | null
}

export type SnapPointKind = 'start' | 'end' | 'midpoint' | 'center' | 'corners'

export type SurfacesConfig = {
  top?: { height: number | ((n: AnyNode) => number) }
  sides?: { faces: 'all' | ReadonlyArray<readonly [number, number, number]> }
  custom?: SurfaceQuery
}

export type SurfaceQuery = (n: AnyNode) => SurfacePoint[]
export type SurfacePoint = {
  position: readonly [number, number, number]
  normal: readonly [number, number, number]
}

export type SelectableConfig = {
  hitVolume?: 'bbox' | 'mesh' | 'none'
  override?: (ctx: CapabilityCtx) => SelectableConfig | null
}

/**
 * Floor-placed kinds rest directly on a level and need their Y lifted by
 * any slab the footprint overlaps. The generic `<FloorElevationSystem>`
 * computes `slabElevation + node.position[1]` and writes it onto the
 * registered mesh on every dirty mark. `footprint` returns the world-space
 * footprint the spatial-grid manager uses to find overlapping slabs;
 * `applies` is an optional predicate to skip nodes that share a kind but
 * are mounted off-floor (items attached to a wall / ceiling).
 */
export type FloorPlacedConfig = {
  footprint: (node: AnyNode) => {
    dimensions: [number, number, number]
    rotation: [number, number, number]
  }
  applies?: (node: AnyNode) => boolean
}

// ─── Relations ───────────────────────────────────────────────────────

export type Relations = {
  linkedBy?: 'endpoint-match' | 'polygon-share' | { custom: (n: AnyNode) => AnyNodeId[] }
  hosts?: readonly string[]
  affectsSpatial?: readonly string[]
  cascadeDelete?: 'descendants' | 'children' | 'none'
}

// ─── ParametricDescriptor ────────────────────────────────────────────

export type ParametricDescriptor<N> = {
  groups: ParamGroup<N>[]
  invariants?: ReadonlyArray<(n: N) => Issue[]>
  derive?: (n: N) => Partial<N>
  customPanel?: () => Promise<{ default: ComponentType<{ node: N }> }>
}

export type ParamGroup<N> = {
  label: string
  fields: ParamField<N>[]
}

export type ParamField<N> =
  | {
      key: keyof N
      kind: 'number'
      unit?: string
      min?: number
      max?: number
      step?: number
      visibleIf?: (n: N) => boolean
      customEditor?: ComponentType
    }
  | { key: keyof N; kind: 'boolean'; visibleIf?: (n: N) => boolean }
  | {
      key: keyof N
      kind: 'enum'
      options: readonly string[]
      /** Defaults to 'select' (dropdown). 'segmented' renders the inline
       *  tabbed switcher — better for short option lists (2-4 items). */
      display?: 'select' | 'segmented'
      visibleIf?: (n: N) => boolean
    }
  | { key: keyof N; kind: 'vec3'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'color'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'material'; visibleIf?: (n: N) => boolean }
  | { key: keyof N; kind: 'ref'; refKind: string; visibleIf?: (n: N) => boolean }
  /** Escape hatch for fields that don't map to a single node key —
   *  derived values (`length` from `start`/`end`), sliders with
   *  dynamic min/max (curve sagitta bounded by chord length),
   *  composed editors, etc. The kind owns the rendering and the
   *  update logic. `key` here is just a stable React key/label. */
  | {
      key: string
      kind: 'custom'
      component: ComponentType<{ node: N; onUpdate: (patch: Partial<N>) => void }>
      visibleIf?: (n: N) => boolean
    }

export type Issue = { field?: string; msg: string; severity?: 'error' | 'warning' }

// ─── Affordance ──────────────────────────────────────────────────────

export type Affordance<N> = {
  id: string
  mount: 'on-selection' | 'on-hover' | 'always'
  enabled?: (n: N, ctx: EditorCtx) => boolean
  component: () => Promise<{ default: ComponentType<{ node: N }> }>
}

export type EditorCtx = {
  modifiers: Modifiers
}

// ─── DragAction primitive ────────────────────────────────────────────

export type Vec2 = readonly [number, number]
export type Modifiers = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean }

export type DragAction<Ctx, Draft> = {
  begin: (input: { node?: AnyNode; point: Vec2; handleId?: string; modifiers?: Modifiers }) => Ctx
  preview: (ctx: Ctx, point: Vec2, modifiers: Modifiers) => Draft
  snap?: (draft: Draft, ctx: Ctx, services: SnapServicesLike) => Draft
  apply: (draft: Draft, ctx: Ctx, scene: SceneApi) => Iterable<AnyNodeId>
  commit?: (draft: Draft, ctx: Ctx, scene: SceneApi) => boolean
  cancel: (ctx: Ctx, scene: SceneApi) => void
}

// Phase 1 fleshes out SnapServices; PR 0.1 only needs the placeholder type.
export type SnapServicesLike = unknown

// ─── SceneApi ────────────────────────────────────────────────────────

export type SceneApi = {
  get: <N extends AnyNode = AnyNode>(id: AnyNodeId) => N | undefined
  update: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  upsert: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId
  delete: (id: AnyNodeId) => void
  restore: (id: AnyNodeId) => void
  restoreAll: () => void
  markDirty: (id: AnyNodeId) => void
  pauseHistory: () => void
  resumeHistory: () => void
}

// ─── Registry surface ────────────────────────────────────────────────

export interface NodeRegistry {
  has: (kind: string) => boolean
  get: (kind: string) => AnyNodeDefinition | undefined
  entries: () => IterableIterator<[string, AnyNodeDefinition]>
  schemas: () => ZodObject<any>[]
  readonly size: number
}
