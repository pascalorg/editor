import type { ComponentType } from 'react'
import type { BufferGeometry, Object3D, Ray } from 'three'
import type { ZodObject, z } from 'zod'
import type { MaterialSchema } from '../schema/material'
import type { SceneMaterial, SceneMaterialId } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import type { HandleList } from './handles'
import type { CloneNodesIntoOptions, Subtree } from './subtree'

// ─── GeometryContext ─────────────────────────────────────────────────
//
// Read-only scene access passed to `def.geometry(node, ctx)`. Most kinds'
// builders ignore `ctx` and read only `node` (shelf, item, spawn). Kinds
// whose meshes reference other nodes by ID — wall miters with siblings,
// door cutouts read parent wall — use `ctx` to resolve those references
// without importing `useScene`. Builders stay pure and unit-testable.
//
// `levelData` carries level-scoped batch data (wall mitering across an
// entire level) from registry dispatchers into pure builders.

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
   * kind declares `def.computeLevelData` (3D) or
   * `def.computeFloorplanLevelData` (2D). Shared across every builder call
   * in the same level batch within a single frame/render pass, so kinds
   * whose geometry depends on cross-sibling data (wall mitering, gradient
   * sky uniforms across a zone, etc.) don't pay an O(N²) recomputation cost.
   *
   * Typed as `unknown` at the framework boundary — kinds cast to their
   * own `LevelData` shape inside `def.geometry` / `def.floorplan` (the
   * same kind owns both the compute hook's return shape and the builder
   * consumer, so the cast is internal).
   */
  levelData?: unknown
  /**
   * The scene's shared material library (`useScene.materials`), passed so a
   * pure geometry builder can resolve `scene:<id>` slot refs without importing
   * `useScene`. Populated by `<GeometrySystem>` for every `def.geometry` call;
   * undefined for `def.floorplan`. `library:<id>` refs resolve against the
   * static catalog and need no store, so builders only consult this for
   * `scene:` refs.
   */
  materials?: Record<SceneMaterialId, SceneMaterial>
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
  /**
   * SVG `pointer-events`. Default (undefined) lets the renderer pick its
   * normal behaviour — `visiblePainted` for filled shapes, `stroke` for
   * line / hit-line. Set `'none'` to make a primitive completely
   * passthrough — useful for chrome that should be visible but never
   * trigger selection or drag (e.g. a wall's body once it's already
   * selected, where only the side-arrows / corner handles should grab
   * the pointer).
   */
  pointerEvents?: 'none' | 'auto' | 'all' | 'stroke' | 'fill' | 'visible' | 'visiblePainted'
  /**
   * CSS `cursor` for the rendered primitive. Defaults to inheriting the
   * registry entry wrapper's `cursor: 'pointer'`. Override to neutralise
   * a hover affordance — e.g. a selected wall body that catches the
   * pointer (to block fall-through to the slab below) but should not
   * advertise itself as a drag target.
   */
  cursor?: string
}

// ─── NodePort ────────────────────────────────────────────────────────
//
// A typed connection point exposed by a node — the open end of a duct
// run, the collar of a fitting, the supply plenum of an air handler.
// Ports are what placement tools snap to and what a future system graph
// walks to decide connectivity.
//
// Coordinates are LEVEL-LOCAL meters — the same space duct paths and
// grid events use. Kinds whose schema stores a node transform
// (`position` / `rotation`) apply it themselves inside `def.ports` so
// consumers never need to know how a kind stores its placement.

export type NodePort = {
  /** Stable identifier within the node, e.g. 'start', 'end', 'branch'. */
  id: string
  /** Level-local meters. */
  position: readonly [number, number, number]
  /** Unit vector pointing OUT of the port (away from the node body). */
  direction: readonly [number, number, number]
  /** Nominal connection diameter in inches. For a rect / oval port this is
   *  the area-equivalent round size, so a round run still mates sensibly. */
  diameter: number
  /** Which distribution loop the port belongs to, e.g. 'supply' | 'return'. */
  system?: string
  /** Cross-section of the connection. Omitted = round at `diameter`. A duct
   *  run joining a rect / oval port adopts this shape and rolls its
   *  cross-section to line up with the collar. */
  shape?: 'round' | 'rect' | 'oval'
  /** Rect / oval cross-section in inches: width is the collar's horizontal
   *  face at roll 0, height the vertical one. */
  width?: number
  height?: number
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
  /**
   * Only show this hint once the in-progress draft has at least this many
   * vertices (reads `useEditor.draftVertexCount`). Lets a polygon tool's
   * "Finish" hint appear only when finishing is actually possible (≥ 3 points),
   * so the HUD reflects reality. Omit for always-shown hints.
   */
  minDraftVertices?: number
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
      /**
       * When true, the registry layer counter-rotates the label by
       * `sceneRotationDeg` so it reads horizontally on screen regardless
       * of the floor-plan's scene rotation (default 90°).
       */
      upright?: boolean
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
      /**
       * Override the default `pointer-events="stroke"`. Use `'none'` when
       * a kind wants to keep the line painted (for hit-debugging or layout
       * stability) but route grabs through other affordances instead.
       */
      pointerEvents?: 'none' | 'stroke' | 'auto'
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
   * Directional move handle drawn as an arrow pointing AWAY from the
   * owning node, rotated by `angle` (radians; 0 = +x). Used by wall to
   * place two arrows on perpendicular sides at the wall midpoint —
   * mirrors the 3D `WallMoveSideHandles`. Routes through the same
   * `onMoveHandlePointerDown` → `setMovingNode` path as `move-handle`.
   */
  | {
      kind: 'move-arrow'
      point: FloorplanPoint
      /** Rotation in radians; 0 points along +x in plan coords. */
      angle: number
      /**
       * Optional affordance routing. When set, pointer-down on the arrow
       * starts a `def.floorplanAffordances?.[affordance]` session with the
       * given `payload` (same dispatch path as `edge-handle`) instead of
       * the default `setMovingNode` flow. Used by doors for the in-plane
       * width-resize handles that visually mirror the move arrow shape but
       * drive a different mutation.
       */
      affordance?: string
      payload?: unknown
    }
  /**
   * Curved two-headed rotation arrow — the 2D counterpart of the 3D
   * `arc-resize` handle's `shape: 'rotate'` gizmo. Visually a short arc
   * with arrowheads at each end pointing tangentially in opposite
   * directions, so it reads as "rotate either way" rather than "drag
   * along a line." Always routes through an affordance (rotation has no
   * sensible default Move semantics).
   *
   * `angle` is the radial-outward direction in plan coords — the icon's
   * local +X axis points away from the pivot, with the arc curving
   * around it. Emitters typically compute this as
   * `atan2(handle.y − pivot.y, handle.x − pivot.x)`.
   */
  | {
      kind: 'rotate-arrow'
      point: FloorplanPoint
      /** Radial-outward direction from the rotation pivot, in radians. */
      angle: number
      affordance: string
      payload?: unknown
      /**
       * Rotation pivot (plan coords) this handle turns the node around.
       * When present, the floor-plan layer draws a live angle wedge + degree
       * readout swept from grab to the current pointer bearing during the
       * drag — the 2D twin of the 3D rotate gizmo's readout. Emitters that
       * already compute the pivot to place the handle should pass it through.
       */
      pivot?: FloorplanPoint
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
   * Equal-spacing badge — a small accent pill marking one gap in a run of
   * (near-)equally-spaced openings (the 2D counterpart of Figma's "=" distance
   * chips). Emitted once per equal gap so the repeated value reads as a rhythm.
   * `text` is the shared gap distance; `angle` orients the pill along the wall
   * (the renderer auto-flips it upright).
   */
  | {
      kind: 'equal-spacing-badge'
      point: FloorplanPoint
      text: string
      /** Rotation in radians. */
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
   * Run a single drag tick. Two patterns are supported:
   *  - **Scene-write preview**: implementation calls `scene.updateNodes`
   *    each tick; the dispatcher captures a pre-drag snapshot and runs
   *    a single-undo dance on commit (revert → resume → re-apply diff).
   *    Suitable for affordances whose commit is a pure diff of the
   *    affected fields.
   *  - **Live-override preview**: implementation publishes per-frame
   *    overrides to `useLiveNodeOverrides` (or another preview store);
   *    `useScene` stays untouched during the drag. The session must
   *    also expose `commit()` below, since there's no scene diff for
   *    the dispatcher to write back.
   *
   * Snap logic, linked-node cascade, and angle locking live here.
   */
  apply(args: {
    planPoint: FloorplanAffordancePoint
    modifiers: FloorplanAffordanceModifiers
  }): void
  /**
   * Called on pointer-up. Return `true` if the drag should commit;
   * `false` reverts to the snapshot (e.g. wall too short, vertex
   * collapsed onto neighbour).
   */
  canCommit(): boolean
  /**
   * Optional atomic-commit hook — mirror of the same field on
   * `FloorplanMoveTargetSession`. When present, the dispatcher
   * reverts to the pre-drag baseline (no-op if `apply()` never wrote
   * to scene), resumes history, then calls `commit()` instead of
   * re-applying a diff. The session owns the full final write
   * (typically `applyNodeChanges` or `updateNodes`) plus clearing any
   * live overrides it published in `apply()`.
   */
  commit?(): void
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
    /** Active editor grid step in meters. */
    gridSnapStep: number
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
  /**
   * Optional atomic-commit hook. The default overlay path snapshots
   * each affected node before drag and writes a diff back on commit —
   * fine for kinds whose commit is a pure position update, but
   * insufficient when commit needs to also create or delete nodes
   * (e.g. wall move emits bridge wall creates + collapsed wall deletes
   * via `planWallMoveJunctions`).
   *
   * When present, the overlay reverts to the pre-drag baseline,
   * resumes history, and calls `commit()` instead of the default
   * `updateNodes(finalUpdates)`. The session is responsible for the
   * full final write (typically `applyNodeChanges`) plus any
   * post-commit selection / metadata. The overlay still emits the
   * standard place SFX and clears `movingNode` after `commit()`
   * returns.
   */
  commit?(): void
  /**
   * Optional R-key flip toggle. Kinds with a directional facing
   * (door / window: front ↔ back) implement this so the overlay can flip
   * the orientation mid-placement before commit. Toggling just records the
   * intent; the visible change lands when the overlay re-runs `apply()` with
   * the last pointer position. Kinds with no facing leave it unset.
   */
  flipSide?(): void
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

/** Role a kind plays in a duct / pipe / lineset distribution system. */
export type DistributionRole = 'run' | 'fitting' | 'terminal' | 'equipment'

/**
 * A kind's snapping profile (see `NodeDefinition.snapProfile`).
 * - `'item'`       free object (furniture/fixtures): lines-default, no grid lattice, no angle.
 * - `'structural'` walls / fences / slabs / ceilings / roofs / zones: grid-default, and an
 *   angle lock while *setting direction* (drafting a run/polygon, dragging an endpoint or a
 *   polygon vertex). A plain translate or a curve of a structural node has no angle.
 */
export type SnapProfile = 'item' | 'structural'

export type NodeDefinition<S extends ZodObject<any>> = {
  kind: string
  schemaVersion: number
  schema: S
  category: NodeCategory
  surfaceRole?: SurfaceRole
  /**
   * Show a floor direction-triangle while placing/moving — the kind has a
   * meaningful front. `true` points along the node's local +Z (forward).
   * `{ reversed: true }` points along local -Z, for kinds whose front is the
   * -Z side (a stair faces *out* of its run: you approach from the low end,
   * which sits on the -Z side of the footprint).
   */
  facingIndicator?: boolean | { reversed?: boolean }
  /**
   * Role this kind plays in a distribution system (HVAC duct / DWV pipe /
   * refrigerant lineset). Lets the system-graph summary classify a
   * component without branching on `node.type`:
   *   - `'run'` — a duct / pipe / lineset segment (carries `path`).
   *   - `'fitting'` — an inline fitting (elbow / tee / reducer / trap).
   *   - `'terminal'` — a grille / register / diffuser endpoint.
   *   - `'equipment'` — a furnace / air handler / condenser source.
   * Kinds outside any distribution system leave this unset.
   */
  distributionRole?: DistributionRole
  /**
   * When `distributionRole` is `'fitting'`, controls whether this fitting
   * is dragged as a rigid follower when a connected run endpoint moves.
   *
   * - `true` (default for `distributionRole === 'fitting'`): the fitting
   *   translates rigidly so its mated collar stays on the moved port — the
   *   right behaviour for in-line fittings (elbows, tees, wyes, crosses).
   * - `false`: the fitting is anchored in space; moving a connected run
   *   endpoint stretches the run arm, not the fitting. Use this for
   *   fixed-position fixtures like `pipe-trap`.
   *
   * Has no effect when `distributionRole` is not `'fitting'`.
   */
  portConnectivityFollow?: boolean

  defaults: () => Omit<z.infer<S>, 'id' | 'type'>
  migrate?: Record<number, (old: unknown) => unknown>

  capabilities: Capabilities
  relations?: Relations
  parametrics?: ParametricDescriptor<z.infer<S>>

  /**
   * Whether scene mutations add this kind to `dirtyNodes` (the per-frame
   * rebuild queue). Default true. Set `false` for structural/organizational
   * kinds (site, building, level, zone, guide) that no dirty consumer ever
   * rebuilds — no `def.geometry`, no legacy viewer system, no
   * `capabilities.floorPlaced`. Their marks are never cleared, so they
   * accumulate for the whole session, defeat every consumer's empty-set
   * early exit each frame, and pollute the perf overlay's DIRTY readout.
   * If a kind later gains a dirty consumer, delete the flag.
   */
  dirtyTracking?: boolean

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
   * Optional cache key over the geometry-relevant inputs of `node`. When
   * set, `<GeometrySystem>` skips the rebuild (dispose + re-create the
   * group's children) if the key is unchanged since the last build for
   * this node — even though the node was marked dirty. Use for kinds whose
   * geometry depends *only* on their own fields (not on `children`,
   * `position`, neighbours, or `ctx`): a hosted child reparenting onto a
   * shelf, say, dirties the shelf but doesn't change its boards, so without
   * this the boards needlessly remount and any pointer hover churns
   * (enter/leave) as the meshes are swapped. Must NOT be set for kinds with
   * neighbour-dependent geometry (e.g. wall/fence miters via `ctx`), whose
   * inputs aren't captured by the node alone.
   */
  geometryKey?: (node: z.infer<S>) => string
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
   * Floor-plan level-batch precompute hook. The floor-plan layer calls this
   * once per level per render pass, de-duplicated by kind, before the
   * per-node `def.floorplan` calls. The result lands in `ctx.levelData` for
   * every node of this kind in the level.
   *
   * Used to hoist cross-sibling floor-plan work that would otherwise be
   * O(N²) when rebuilding every node in a kind — e.g. wall mitering. `nodes`
   * is the live-merged scene snapshot; `siblings` is every node of this kind
   * in the level, also live-merged.
   */
  computeFloorplanLevelData?: (args: {
    siblings: ReadonlyArray<z.infer<S>>
    nodes: Record<string, AnyNode>
  }) => unknown
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
   * Which scope the floor-plan layer walks to find instances of this
   * kind. Default `'level'` — the layer's DFS from the active level id
   * picks the node up via its parent chain. `'building'` — the kind
   * lives as a sibling of levels (elevator is the canonical example:
   * elevators are parented to the *building*, not a level, but the
   * floor-plan should still surface them for every level inside that
   * building). For `'building'`-scoped kinds the layer iterates every
   * instance whose parent matches the active level's building, and
   * synthesises a `GeometryContext` whose `parent` is the active level.
   */
  floorplanScope?: 'level' | 'building'
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
  /**
   * Geometry reads sibling/parent/child nodes (e.g. wall miters, opening
   * dimensions); the floor-plan layer must rebuild it whenever a
   * sibling-affecting node is being dragged live.
   */
  floorplanDependsOnSiblings?: boolean
  /**
   * Optional hook letting a kind project the `useLiveNodeOverrides` map
   * into a fresh `nodes` snapshot before its `def.floorplan` builder
   * runs. The floor-plan layer calls this when present and passes the
   * returned map both as the builder's `ctx` source AND as the
   * effective node (so the kind's own override lands in `effectiveNode`).
   *
   * Used by wall, whose miter joins read sibling walls via
   * `ctx.siblings`: during a 2D drag the moved wall + its linked
   * neighbours publish per-frame `{ start, end, curveOffset }`
   * overrides, and the floor-plan must merge those into every wall
   * the builder can see — otherwise miter math snaps back to the
   * committed positions while the cursor moves. Kinds whose previews
   * are self-contained leave this unset and the layer hands the raw
   * `nodes` through.
   *
   * Return the input `nodes` unchanged when no override is relevant
   * so the caller can short-circuit.
   */
  floorplanSiblingOverrides?: (args: {
    nodeId: AnyNodeId
    nodes: Record<AnyNodeId, AnyNode>
    liveOverrides: Map<string, Record<string, unknown>>
  }) => Record<AnyNodeId, AnyNode>
  /**
   * Typed connection points this kind exposes (duct/pipe open ends,
   * fitting collars, equipment plenums). Pure function of the node —
   * returns LEVEL-LOCAL positions/directions (the kind applies its own
   * transform). Consumed by placement tools for port-snapping and, in a
   * later slice, by the system graph for connectivity. Kinds with no
   * connectable geometry omit this.
   */
  ports?: (node: z.infer<S>) => NodePort[]
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
   * Which snapping profile this kind uses, so the editor's contextual snapping
   * HUD + snap math + force-place affordance are node-declared rather than
   * switched on the kind name (`'item'` free object vs `'structural'` wall/slab/
   * surface — see `SnapProfile`). The angle lock is derived from the *action*
   * (setting direction), not declared here. Also gates the "force place" hint:
   * structural kinds don't collision-reject, so they don't show it.
   * Omit it for kinds whose placement/move tools haven't moved onto the unified
   * snapping model yet — they get no snapping chip (no Shift-cycle) until they do.
   */
  snapProfile?: SnapProfile

  /**
   * For `structural` kinds: does drafting this kind set a DIRECTION (so the
   * angle-lock snapping mode is meaningful)? Wall/fence/slab/ceiling drafting
   * draws directed edges → `true` (the default). Roof/stair/elevator are placed
   * as axis-aligned footprints, not directional draws → `false`, so their
   * drafting uses the no-angle `polygon` snap context (grid / lines / off)
   * instead of the angle-bearing `wall` context. Ignored for `item` kinds
   * (their context never carries an angle lock).
   */
  snapDraftDirectional?: boolean

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

  /**
   * In-world resize / move arrows shown when this kind is selected.
   *
   * Pure descriptors — no React, no Three.js. The editor's generic
   * `<NodeArrowHandles>` reads this list and mounts the matching arrow
   * components with shared drag plumbing, replacing per-kind
   * `<XxxSideHandles>` files for the common cases.
   *
   * Static array, or a function for shape-dependent affordances
   * (column `crossSection` / `supportStyle`, stair-segment `segmentType`,
   * curved-vs-straight stairs). See `./handles.ts` for the variant union.
   *
   * Bespoke chrome that doesn't fit the descriptor model (wall corner
   * leader dashes, fence curving, items with `attachTo`) stays as a
   * custom React component mounted alongside.
   */
  handles?: HandleList<z.infer<S>>
}

export type NodeCategory = 'site' | 'structure' | 'furnish' | 'analysis' | 'utility'

// ─── Keyboard actions ────────────────────────────────────────────────

export type KeyboardActions = {
  /** R / Shift+R primary action. */
  r?: KeyboardAction
  /** T / Shift+T secondary action. */
  t?: KeyboardAction
  /**
   * Set for kinds whose R/T rotation turns around a user-cyclable world
   * axis (Alt cycles Y → X → Z) — duct / pipe fittings with full 3D
   * orientation. The floating action menu reads this to surface the
   * active-axis pill above the selected node; kinds with plain Y-only
   * rotation omit it.
   */
  axisCycling?: boolean
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
  /**
   * Plan footprint this kind exposes to the alignment-anchor pool when it
   * isn't `floorPlaced` and isn't a structural primitive the bridge handles
   * directly (wall, slab). Lets a kind self-describe where it sits in plan
   * instead of the core anchor bridge hardcoding it per type. See
   * `AlignmentFootprintConfig`.
   */
  alignmentFootprint?: AlignmentFootprintConfig
  /**
   * Bounds drawn by the 3D drag bounding box during a move. Opt-in: when
   * omitted, the box auto-measures the rendered mesh, which is correct for
   * most kinds. Set this when the rendered mesh tree contains extras the
   * user wouldn't think of as "the thing being dragged" — e.g. an elevator
   * whose mesh includes per-level landing assemblies, and the user expects
   * the box to wrap just the shaft they're moving.
   *
   * `size`: `[width, height, depth]` in the node's local frame.
   * `centerY`: optional Y center; defaults to `size[1] / 2` (box sits on
   * the ground plane). Override when the local origin isn't at the base.
   */
  dragBounds?: (
    node: AnyNode,
    nodes?: Readonly<Record<string, AnyNode>>,
  ) => { size: [number, number, number]; centerY?: number }
  roofAccessory?: RoofAccessoryConfig
  /**
   * Kind cuts a hole in the ceiling surface it is attached to (e.g. recessed
   * downlights). The viewer's `CeilingSystem` calls this for each child of a
   * ceiling to collect extra holes before triangulating. See `CeilingCutCapability`.
   */
  ceilingCut?: CeilingCutCapability
  paint?: PaintCapability
  /**
   * Declares the kind's paintable slots — the `{ slotId, label, default }`
   * contract shared by items (scanned from the GLB) and procedural kinds
   * (declared here). Procedural generators tag their emitted geometry with
   * `userData.slotId` and resolve each slot's material from
   * `node.slots[slotId]` → this declaration's `default` → role colour. The
   * declaration is a function of the node because a kind's slot set can depend
   * on its parameters (a shelf has a `back` slot only when it has a back).
   */
  slots?: (node: AnyNode) => SlotDeclaration[]
  /**
   * Kind is placed by clicking on a wall (door, window). When set, the
   * floor-plan layer lets wall background clicks pass through during
   * placement / move-on-wall — the placement tool's `wall:click` event
   * needs the SVG's `findClosestWallPoint` handler to run; without
   * this the wall's registry entry would swallow the click via
   * `handleSelect`. Read by `FloorplanRegistryLayer` when `movingNode`
   * is set, so the active move can suspend wall selection.
   */
  wallOpeningPlacement?: boolean
  /**
   * Instances of this kind contain levels. When such a node is being
   * moved, the floor-plan layer falls back to the moving node's id as
   * the ambient building context — so the floor under the cursor keeps
   * rendering dimmed throughout the gesture even though the explicit
   * selection may have been cleared as part of the move handoff. Set
   * on building; future container kinds (e.g. annexes) opt in by
   * declaring the same flag.
   */
  floorplanLevelContainer?: boolean
  /**
   * Names of schema fields on this kind that are *host references* —
   * values derived from where the node is placed (rather than declared
   * by the user as part of the kind's parametric configuration). Read
   * by host apps at preset-save time to strip these from the stored
   * payload so a placed instance gets fresh host links at the new
   * placement site (e.g. a door snapshot loses `wallId`/`wallT`; at
   * placement the auto-attach UX re-derives them from the wall under
   * the cursor).
   *
   * Kinds with no host refs omit this field (default `[]`).
   *
   * Examples:
   *   - door: `['wallId', 'wallT']` (door hosted on a wall)
   *   - window: `['wallId', 'wallT']`
   *   - item with `attachTo`: depends on the asset; the kind's
   *     `defaults()` or the dragging logic populates it dynamically.
   */
  hostRefFields?: string[]
  /**
   * Whether instances of this kind can be saved as a reusable preset
   * (unified `items` catalog, `kind='preset'`). The editor itself does
   * not act on this flag — host apps read it to gate "save as preset"
   * UI on the selected node. Default resolution (callers should use the
   * `isPresettable(def)` helper rather than reading this directly):
   *
   *   - explicit `true`  → presettable
   *   - explicit `false` → not presettable
   *   - undefined        → presettable when `def.parametrics` exists
   *
   * Structural / utility kinds (level, building, site, zone, spawn,
   * guide, scan, item) opt out explicitly because saving them as a
   * standalone preset has no meaning — items already have their own
   * catalog, scans/guides carry user-uploaded imagery, and the rest
   * are non-leaf scene containers.
   */
  presettable?: boolean
  /**
   * Instances of this kind are created by operating a build tool and
   * drawing on the grid (clicking points), rather than dropping a
   * finished instance. The tool id equals the node `type`. Host apps may
   * seed the tool's starting parameters via
   * `useEditor.setToolDefaults(type, params)` before activating it — the
   * tool's create path merges those defaults when minting the node and
   * clears its own entry on deactivation. Used so placing a saved preset
   * of a drawn kind contributes its build parameters (a fence's
   * height / style / post spacing) while the user draws the fresh span,
   * and so a future "small / medium / large" picker can prime the same
   * tool. Read via the `isDrawnViaTool(def)` helper. Default `false`.
   */
  drawTool?: boolean
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
/**
 * One paintable slot a kind exposes. `slotId` is the stable key written into
 * `node.slots`; `label` is the human name (sentence case). `default` is the
 * slot's fallback appearance when no override is set — either a `MaterialRef`
 * (`library:<id>` / `scene:<id>`) or a `#rrggbb` colour. Mirrors the shape
 * items derive from their GLB material names.
 */
export type SlotDeclaration = {
  slotId: string
  label: string
  default?: string
}

export type PaintCapability = {
  /**
   * Opt this kind into the painter's `room` application scope: a paint click
   * spreads to every same-kind node bounding the clicked node's room (walls and
   * slabs). The room geometry is resolved by the editor from `Space.polygon`;
   * this flag only declares that the kind participates.
   */
  roomScope?: boolean
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
   * Optional: fully own the click-commit instead of the default
   * `updateNode(node.id, buildPatch(...))`. Kinds whose commit has a side
   * effect (items create a scene material for one-off colours, then store a
   * `scene:<id>` ref) implement this; kinds that just patch the node omit it.
   * Must perform its mutations as a single undo step.
   */
  commit?: (args: PaintPatchArgs) => void
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
  /** Optional: the three.js object that received the pointer hit. Items read userData.slotId off it. */
  hitObject?: Object3D
  /**
   * Optional: the pointer's world ray, so a kind can re-raycast its OWN subtree
   * to pick the precise sub-mesh under the cursor — independent of what the
   * shared scene raycast hit first. Door/window use this: their opening proxy
   * (a proud invisible cutout) wins the scene raycast over the wall in front of
   * the recessed door body, then they re-raycast their parts to find the slot.
   */
  ray?: Ray
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
  /**
   * Which segment brushes `buildCut` subtracts from. Wall-face openings
   * (door / window) cut only the wall brush — subtracting the same box
   * from the shin / deck slabs is pointless work and creates tangential
   * / coplanar CSG cases near the gable and shed slopes. Defaults to
   * all three (skylight / dormer genuinely poke through the deck).
   */
  cutScope?: 'all' | 'wall'
  /**
   * The kind's own dirty-driven geometry system consumes its dirty
   * marks (door / window via DoorSystem / WindowSystem, which already
   * cascade to the host segment through `parentId`). The roof-merge
   * loop must then leave those marks alone — consuming them would
   * starve that system whenever it defers a rebuild (mesh not mounted
   * yet, per-frame rebuild budget exhausted).
   */
  dirtyHandledByOwnSystem?: boolean
}

/**
 * Capability for kinds that cut a hole in their host ceiling when the node is
 * attached to a ceiling surface (e.g. recessed downlights). The viewer's
 * `CeilingSystem` queries children of a ceiling for this capability and merges
 * the returned polygons as extra holes before triangulating, keeping the viewer
 * free of per-kind branching.
 *
 * Returns a rotated-rectangle footprint in ceiling-local [x, z] plan space —
 * the same coordinate space as `CeilingNode.polygon` and `.holes`. Return
 * `null` when this particular instance should not cut a hole (e.g. a
 * non-recessed variant of the same kind).
 */
export type CeilingCutCapability = {
  buildCeilingHole: (node: AnyNode) => Array<[number, number]> | null
}

export type CapabilityCtx = { node: AnyNode }

export type MovableConfig = {
  axes: ReadonlyArray<'x' | 'y' | 'z'>
  gridSnap?: boolean
  /**
   * Pin the dragged node to the cursor (absolute placement) instead of the
   * default offset-preserving drag, where the node moves by the cursor's
   * delta from where the drag started. Offset preservation suits large
   * furniture you grab by an edge; small connector-like kinds (duct
   * fittings) read as "lagging behind the mouse" — they want the cursor.
   */
  cursorAttached?: boolean
  /**
   * Magnetically snap one of this kind's own ports onto a nearby scene
   * port while dragging — e.g. a register's collar onto a duct run end.
   * The dragged node shifts in XZ so its closest matching port lands on
   * the target port. Alt bypasses the snap. Kinds without `def.ports`
   * can't use this. Snap takes precedence over grid / alignment snap.
   */
  portSnap?: {
    /**
     * Distribution loops a target port must belong to (e.g.
     * `['supply', 'return']`). A target port with no `system` always
     * matches. Omit to match every port.
     */
    systems?: readonly string[]
    /** Snap radius in meters (XZ). Defaults to 0.5. */
    radius?: number
  }
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

export type FloorPlacedFootprint = {
  dimensions: [number, number, number]
  rotation: [number, number, number]
  position?: [number, number, number]
}

export type FloorPlacedFootprintContext = {
  nodes: Readonly<Record<AnyNodeId, AnyNode>>
}

export type FloorPlacedFootprintResolver = (
  node: AnyNode,
  ctx?: FloorPlacedFootprintContext,
) => FloorPlacedFootprint

export type FloorPlacedFootprintsResolver = (
  node: AnyNode,
  ctx?: FloorPlacedFootprintContext,
) => readonly FloorPlacedFootprint[]

/**
 * Floor-placed kinds rest directly on a level and need their Y lifted by
 * any slab the footprint overlaps. The generic `<FloorElevationSystem>`
 * computes `slabElevation + node.position[1]` and writes it onto the
 * registered mesh on every dirty mark. `footprint` returns the default
 * world-space footprint the spatial-grid manager uses to find overlapping
 * slabs; `footprints` lets composite kinds expose multiple footprint
 * segments, with the canonical resolver taking the max slab elevation;
 * `applies` is an optional predicate to skip nodes that share a kind but
 * are mounted off-floor (items attached to a wall / ceiling).
 */
export type FloorPlacedConfig = {
  footprint?: FloorPlacedFootprintResolver
  footprints?: FloorPlacedFootprintsResolver
  applies?: (node: AnyNode) => boolean
  /**
   * Opt this kind into floor-placement collision: its footprint blocks other
   * placements (it's an obstacle in `canPlaceOnFloor`) AND its own
   * placement/move refuses to overlap another colliding footprint (red ghost,
   * Alt to force). Solid furniture-like kinds (item / shelf / column) set this;
   * markers and port-mated kinds (spawn / MEP / stair) leave it off so they
   * neither block nor get blocked. Default off.
   */
  collides?: boolean
}

/**
 * Plan footprint a kind contributes to the alignment-anchor pool when it is
 * neither `floorPlaced` (columns / items, whose footprint the bridge already
 * reads) nor a primitive the bridge knows structurally (walls → segments,
 * slabs → polygons). Two shapes:
 *
 *   - `box`  — a rotatable rectangle centred on the node's `position`. Use
 *     when the kind also moves by its footprint edges (elevator): the anchor
 *     bridge relocates the box to the proposed drag point, so one descriptor
 *     serves both the static candidate and the moving node.
 *   - `aabb` — an already-resolved XZ bounding box, for kinds whose plan
 *     shape isn't a centred rectangle (stair: a segment chain or annular
 *     sector). The moving-anchor bridge can relocate these by patching the
 *     proposed plan position and resolving the AABB again.
 *
 * `nodes` is supplied only when a kind needs siblings / children to resolve
 * its footprint (a straight stair walks its `stair-segment` children); box
 * kinds derive everything from `node` alone.
 */
export type AlignmentFootprint =
  | { shape: 'box'; dimensions: [number, number, number]; rotation: [number, number, number] }
  | { shape: 'aabb'; minX: number; minZ: number; maxX: number; maxZ: number }

export type AlignmentFootprintConfig = (
  node: AnyNode,
  nodes?: Readonly<Record<string, AnyNode>>,
) => AlignmentFootprint | null

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
  /**
   * Co-update hook for fields that must stay consistent when edited
   * from the inspector. Called with the node AFTER `patch` is merged
   * plus the patch itself (so the hook can tell which field the user
   * touched); whatever it returns is folded into the same update.
   * Direct store/MCP writes bypass it — keep real invariants in
   * `invariants`.
   */
  derive?: (next: N, patch: Partial<N>) => Partial<N>
  /**
   * Cross-node companion to `derive`: after an inspector edit lands on
   * this node, return patches for OTHER nodes that must follow to keep
   * the scene consistent — e.g. duct runs re-trimmed onto a resized
   * fitting's collars. `prev` is the node before the edit, `next` after
   * (with `derive` already folded in). Applied in the same gesture via
   * `updateNodes`.
   */
  reconcile?: (prev: N, next: N) => Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  /**
   * Deletion companion to `reconcile`: when a node of this kind is about
   * to be removed, return patches for OTHER nodes that must follow to
   * undo whatever the node imposed on its neighbours — e.g. an
   * auto-inserted elbow re-extends the duct runs it trimmed back onto the
   * corner it replaced. Called with the node and the live scene `nodes`
   * map BEFORE the deletion lands; patches targeting nodes also being
   * deleted are ignored. Applied in the same `set` as the delete so it's
   * one undo step. Fires only on `deleteNodes` (user-intent deletes) —
   * NOT on `applyNodeChanges`, whose deletes are internal re-routes that
   * rewrite neighbours explicitly in the same batch and would fight a
   * restore.
   */
  onDelete?: (
    node: N,
    nodes: Record<AnyNodeId, AnyNode>,
  ) => Array<{ id: AnyNodeId; data: Partial<AnyNode> }>
  customPanel?: () => Promise<{ default: ComponentType<{ node: N }> }>
  /**
   * Extra buttons rendered in the inspector's Actions section
   * (below Move/Delete). Lets a kind declare "do this thing to the
   * current node" affordances without escaping to a full custom
   * panel. Buttons whose `enabledIf` returns false stay disabled.
   */
  actions?: ParamAction<N>[]
  /**
   * Lazy-loaded React subsection rendered AFTER the auto-derived
   * groups and BEFORE the Actions section. Used by kinds that want
   * to list their child nodes inline — e.g. the gutter's downspout
   * list with an "Add Downspout" button at the bottom, same shape as
   * the roof panel's gutter / vent lists. Kind owns the layout; the
   * inspector just slots it in.
   */
  trailingSection?: () => Promise<{ default: ComponentType<{ node: N }> }>
}

export type ParamAction<N> = {
  label: string
  /** Optional asset URL for a leading icon — same shape as palette icons. */
  iconSrc?: string
  enabledIf?: (n: N) => boolean
  /** Click handler. Receives the current node value at click time. */
  onClick: (n: N) => void
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
  /**
   * Snapshot of the full nodes record. For descriptors / placement
   * callbacks that need to walk many siblings or resolve cross-node
   * structure (elevator level entries, building level chains, etc.)
   * without N round-trips through `get`. Returns the live reference —
   * do not mutate.
   */
  nodes: () => Readonly<Record<AnyNodeId, AnyNode>>
  update: (id: AnyNodeId, patch: Partial<AnyNode>) => void
  upsert: (node: AnyNode, parentId?: AnyNodeId) => AnyNodeId
  delete: (id: AnyNodeId) => void
  restore: (id: AnyNodeId) => void
  restoreAll: () => void
  markDirty: (id: AnyNodeId) => void
  pauseHistory: () => void
  resumeHistory: () => void
  /**
   * Collect the subtree of live nodes rooted at `rootId` — `root` plus
   * every descendant reachable via `children[]` in BFS order. Returns
   * live node references (no clones); the caller decides whether to
   * persist by value or pass them straight into {@link cloneNodesInto}.
   * Returns `null` if `rootId` is missing.
   */
  getSubtree: (rootId: AnyNodeId) => Subtree | null
  /**
   * Clone a flat array of nodes into the live scene with fresh IDs and
   * rewired parent / children references. Intentionally generic — see
   * {@link cloneNodesInto} for the transformations applied. Does NOT
   * strip or re-derive host references (e.g. `wallId` on a door); the
   * caller is responsible for that policy (read {@link Capabilities.hostRefFields}
   * on the relevant definition).
   *
   * Returns the new root id, or `null` if insertion failed.
   */
  cloneNodesInto: (nodes: ReadonlyArray<AnyNode>, opts: CloneNodesIntoOptions) => AnyNodeId | null
}

// ─── Registry surface ────────────────────────────────────────────────

export interface NodeRegistry {
  has: (kind: string) => boolean
  get: (kind: string) => AnyNodeDefinition | undefined
  entries: () => IterableIterator<[string, AnyNodeDefinition]>
  schemas: () => ZodObject<any>[]
  readonly size: number
}
