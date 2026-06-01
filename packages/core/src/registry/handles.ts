// In-world resize / move arrow descriptors. Each `NodeDefinition` may
// declare a `handles` list (or a `(node) => list` function for shape-
// dependent affordances). The editor mounts a single generic component
// that reads these descriptors and renders the arrows / drag logic — no
// per-kind handles file needed.
//
// Pure data + small per-descriptor callbacks: no Three.js, React, or
// editor imports here so this stays in core. The descriptors are
// evaluated by the editor at drag time (`apply` etc.) so the callbacks
// run in the editor's context — they see the live node and the scene
// API but otherwise do not import 3D libraries.
//
// Layered intentionally:
//   - axis-resize    : symmetric scaling around center (column W/D, height)
//   - edge-resize    : anchored on one edge, the other follows the pointer
//                      (door width: drag right edge, left edge stays)
//   - vertical-resize: linear-resize specialised for world-Y (height arrow
//                      anchored at bottom; window top-edge anchored at
//                      bottom; window bottom-edge anchored at top)
//   - radial-resize  : 1:1 outward growth of a radial field (column radius)
//   - arc-resize     : curved/spiral stair sweep / inner-radius / rise
//   - endpoint-move  : wall / fence endpoint drag (snapping is bespoke,
//                      so it delegates to a kind-supplied callback)

import type { AnyNode } from '../schema/types'
import type { SceneApi } from './types'

/**
 * Editor-facing verbs that handle descriptors can invoke.
 *
 * Parallel to {@link SceneApi} but exposes EDITOR state mutations (move
 * tools, endpoint dragging, etc.) instead of scene-data writes. Descriptors
 * receive a concrete implementation from the editor at drag time — `core`
 * only carries the interface so node definitions can call into editor
 * affordances without importing the editor package.
 *
 * Minimal verb set today; grow it as new descriptor variants land
 * (engageCurve for wall/fence curving, etc.).
 */
export type EditorApi = {
  /**
   * Hand the node to its registered move tool (the same path the floating
   * menu's Move icon uses). Implementations clear any in-progress endpoint
   * or curving state so the move starts from a clean slate.
   */
  engageMove: (node: AnyNode) => void
  /**
   * Engage endpoint drag for kinds that own start / end anchors (walls,
   * fences). No-ops for kinds without endpoints.
   */
  engageEndpointMove: (node: AnyNode, endpoint: 'start' | 'end') => void
}

export type HandlePortal = 'self' | 'parent' | 'grandparent'

export type HandleAxis = 'x' | 'y' | 'z'

export type HandleAnchor = 'center' | 'min' | 'max'

/** 3D position + rotation of the arrow in its portal target's local space. */
export type HandlePlacement<N> = {
  /**
   * `sceneApi` is supplied so descriptors that depend on cross-node state
   * (elevator height resolving level entries, future cross-kind handles)
   * can compute placement against the live scene. Existing descriptors
   * that only need `node` can ignore the second argument.
   */
  position: (node: N, sceneApi: SceneApi) => readonly [number, number, number]
  /** Optional Y rotation (radians). Defaults to 0. */
  rotationY?: (node: N, sceneApi: SceneApi) => number
}

export type Cursor = 'ew-resize' | 'ns-resize' | 'move' | 'grab' | 'grabbing'

/**
 * Visual decoration shown alongside a handle while the user is hovering
 * or dragging it. Today: a thin horizontal ring at a node-local radius —
 * the curved-stair width / inner-radius arrows use this to trace the
 * outer rim / inner pillar so the user sees what the drag affects.
 *
 * Pure data: the editor's arrow renderer reads it and mounts the visual.
 */
export type HandleDecoration<N> = {
  kind: 'ring'
  /** Node-local radius of the ring (XZ plane). */
  radius: (node: N) => number
  /** Node-local Y of the ring. Defaults to 0. */
  y?: (node: N) => number
}

/**
 * Linear resize along a single local axis. Covers width / depth / height
 * arrows whose visible behaviour is "drag the +axis edge, the dimension
 * grows."
 *
 * `anchor` controls which side stays fixed:
 *   - 'center' : symmetric — both edges move ±delta (column width/depth).
 *   - 'min'    : the -axis edge is fixed; drag the +axis edge by `delta`
 *                grows the value by `delta` (column height with origin at
 *                base; door height with bottom anchored).
 *   - 'max'    : the +axis edge is fixed; drag the -axis edge.
 *
 * `apply(node, newValue)` returns the partial patch. Use it to write
 * sibling fields too (e.g. door 'max' anchor re-centers `position[0]`).
 */
export type LinearResizeHandle<N> = {
  kind: 'linear-resize'
  /** Local axis. The arrow's chevron points along +axis. */
  axis: HandleAxis
  anchor: HandleAnchor
  currentValue: (node: N) => number
  apply: (node: N, newValue: number, sceneApi: SceneApi) => Partial<N>
  min?: number | ((node: N, sceneApi: SceneApi) => number)
  max?: number | ((node: N, sceneApi: SceneApi) => number)
  placement: HandlePlacement<N>
  /**
   * Defaults to 'self' (arrow lives in the selected node's own mesh).
   * 'parent' uses the parent mesh — used by doors/windows whose handles
   * need to ride the wall's rotation.
   */
  portal?: HandlePortal
  cursor?: Cursor
  /** Optional visual guide shown while the arrow is hovered or dragging. */
  decoration?: HandleDecoration<N>
}

/**
 * 1:1 outward growth — dragging the arrow outward by `delta` grows the
 * value by `delta` (the visible edge follows the pointer). Use for radii
 * and other fields where the conceptual model is "the +axis edge IS the
 * thing being moved" rather than "the size IS being scaled."
 */
export type RadialResizeHandle<N> = {
  kind: 'radial-resize'
  axis: HandleAxis
  currentValue: (node: N) => number
  apply: (node: N, newValue: number, sceneApi: SceneApi) => Partial<N>
  min?: number | ((node: N, sceneApi: SceneApi) => number)
  max?: number | ((node: N, sceneApi: SceneApi) => number)
  placement: HandlePlacement<N>
  portal?: HandlePortal
  /** Optional visual guide shown while the arrow is hovered or dragging. */
  decoration?: HandleDecoration<N>
}

/**
 * Curved / spiral stair sweep arrows. The renderer raycasts a horizontal
 * plane through the arrow's Y and emits the angular delta (radians,
 * signed, normalised to [-π, π]) around the node's local origin.
 *
 * Unlike the linear variants, `apply` receives the raw cursor delta
 * (not a `newValue`) because sweep handles typically write multiple
 * fields off the delta (`sweepAngle` AND `rotation` — re-orienting the
 * arc so the opposite edge stays world-fixed). Descriptor-internal
 * math handles the per-end sign and any clamping; the renderer stays
 * out of it.
 */
export type ArcResizeHandle<N = any> = {
  kind: 'arc-resize'
  /**
   * Marks the drag mode. Only 'angular' uses the polar plane renderer;
   * 'radial' and 'vertical' degenerate to `linear-resize` (axis 'x' /
   * 'y') so descriptors should prefer that for those cases.
   */
  axis: 'angular'
  /** Optional metadata for descriptors that bundle two handles per kind. */
  end?: 'start' | 'end'
  apply: (initialNode: N, delta: number, sceneApi: SceneApi) => Partial<N>
  placement: HandlePlacement<N>
  portal?: HandlePortal
  /** Optional visual guide shown while the arrow is hovered or dragging. */
  decoration?: HandleDecoration<N>
  /**
   * Visual override. Defaults to the standard chevron (used by the
   * stair-sweep extend handles). 'rotate' renders a two-headed curved
   * arrow icon, intended for whole-node rotation handles.
   */
  shape?: 'chevron' | 'rotate'
}

/**
 * Wall / fence endpoint drag. Snapping and adjacency belong to the kind,
 * so the descriptor declares the placement and hands the world-space
 * pointer position back to `apply`. The kind can splice walls, snap to
 * a grid, merge with a neighbour, etc., and returns the partial patch.
 */
export type EndpointMoveHandle<N> = {
  kind: 'endpoint-move'
  endpoint: 'start' | 'end'
  placement: HandlePlacement<N>
  /** Called with the world-space hit on the ground plane. */
  apply: (node: N, worldPoint: readonly [number, number, number], sceneApi: SceneApi) => Partial<N>
  portal?: HandlePortal
}

// Default to `any` so type-erased renderers can hold `HandleDescriptor[]`
// without each variant's contravariant `currentValue: (node: N) => ...`
// callback fighting the union widening. Per-kind defs supply a real N.
/**
 * Click-to-engage affordance. The descriptor doesn't drive a drag — its
 * single job is to mount a click target at `placement` and dispatch a
 * verb on the editor API when the user clicks. Used by wall side-move
 * (engage move tool) and wall corner pickers (engage endpoint move).
 *
 * The renderer picks the visual from `shape`. Default `'arrow'` reuses
 * the chevron shape every resize handle uses. `'corner-picker'` renders
 * a dashed vertical leader + billboarded hex disc + ring, anchored at
 * `placement.position` and extending up to `nodeHeight(node)`.
 */
export type TapActionHandle<N = any> = {
  kind: 'tap-action'
  placement: HandlePlacement<N>
  /**
   * Dispatched on pointer-down. Use scene/editor APIs to read state +
   * trigger the desired action.
   */
  onActivate: (node: N, scene: SceneApi, editor: EditorApi) => void
  /** Visual override; defaults to the standard chevron arrow. */
  shape?: 'arrow' | 'corner-picker'
  /**
   * Required when `shape: 'corner-picker'` — controls the dashed leader's
   * vertical extent. Pure callback so the descriptor doesn't need to
   * import 3D libs.
   */
  nodeHeight?: (node: N) => number
  portal?: HandlePortal
  cursor?: Cursor
}

export type HandleDescriptor<N = any> =
  | LinearResizeHandle<N>
  | RadialResizeHandle<N>
  | ArcResizeHandle<N>
  | EndpointMoveHandle<N>
  | TapActionHandle<N>

/**
 * Static array, or a function for shape-dependent cases (column
 * crossSection / supportStyle, stair-segment segmentType, etc.).
 */
export type HandleList<N> = HandleDescriptor<N>[] | ((node: N) => HandleDescriptor<N>[])
