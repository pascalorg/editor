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

import type { SceneApi } from './types'

export type HandlePortal = 'self' | 'parent' | 'grandparent'

export type HandleAxis = 'x' | 'y' | 'z'

export type HandleAnchor = 'center' | 'min' | 'max'

/** 3D position + rotation of the arrow in its portal target's local space. */
export type HandlePlacement<N> = {
  position: (node: N) => readonly [number, number, number]
  /** Optional Y rotation (radians). Defaults to 0. */
  rotationY?: (node: N) => number
}

export type Cursor = 'ew-resize' | 'ns-resize' | 'move'

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
}

/**
 * Curved / spiral stair arrows. The drag plane is computed in polar
 * coordinates around the node's local origin so the descriptor only
 * needs to declare which polar component changes:
 *   - 'angular' : sweep — pointer arc-length maps to angle delta
 *   - 'radial'  : inner radius / width — radial distance maps 1:1
 *   - 'vertical': rise — pointer Y maps 1:1 to height delta
 *
 * `end` distinguishes the start / end sweep handles on curved stairs.
 */
export type ArcResizeHandle<N> = {
  kind: 'arc-resize'
  axis: 'angular' | 'radial' | 'vertical'
  end?: 'start' | 'end'
  currentValue: (node: N) => number
  apply: (node: N, newValue: number, sceneApi: SceneApi) => Partial<N>
  min?: number | ((node: N, sceneApi: SceneApi) => number)
  max?: number | ((node: N, sceneApi: SceneApi) => number)
  placement: HandlePlacement<N>
  portal?: HandlePortal
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
  apply: (
    node: N,
    worldPoint: readonly [number, number, number],
    sceneApi: SceneApi,
  ) => Partial<N>
  portal?: HandlePortal
}

// Default to `any` so type-erased renderers can hold `HandleDescriptor[]`
// without each variant's contravariant `currentValue: (node: N) => ...`
// callback fighting the union widening. Per-kind defs supply a real N.
export type HandleDescriptor<N = any> =
  | LinearResizeHandle<N>
  | RadialResizeHandle<N>
  | ArcResizeHandle<N>
  | EndpointMoveHandle<N>

/**
 * Static array, or a function for shape-dependent cases (column
 * crossSection / supportStyle, stair-segment segmentType, etc.).
 */
export type HandleList<N> = HandleDescriptor<N>[] | ((node: N) => HandleDescriptor<N>[])
