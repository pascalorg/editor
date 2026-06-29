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

import type { AnyNode, AnyNodeId } from '../schema/types'
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
   * Like {@link engageMove}, but for a press-drag gizmo: the move commits on
   * pointer-release instead of waiting for a click, so the on-canvas move cross
   * behaves as press-drag-release while still showing the placement preview.
   */
  engageMoveDrag: (node: AnyNode) => void
  /**
   * Engage endpoint drag for kinds that own start / end anchors (walls,
   * fences). No-ops for kinds without endpoints.
   */
  engageEndpointMove: (node: AnyNode, endpoint: 'start' | 'end') => void
  /**
   * Engage drag of a spline control point (`path[index]`). Used by spline
   * fences to reshape their centerline. No-ops for kinds without a path.
   */
  engageControlPointMove: (node: AnyNode, index: number) => void
  /**
   * Engage drag of a spline tangent handle (`path[index]`, which end). Used by
   * spline fences to bend the curve through one control point. No-ops for kinds
   * without tangents.
   */
  engageTangentMove: (node: AnyNode, index: number, side: 'in' | 'out') => void
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
  /**
   * Optional per-tick hook fired while this handle is being dragged, with the
   * live (in-progress, override-merged) node. A pure side-channel for transient
   * feedback — doors/windows use it to publish proximity / sill guides for the
   * edge being resized. The return value is ignored; the resize itself is driven
   * by `apply`.
   */
  onDrag?: (node: N, sceneApi: SceneApi) => void
  /**
   * Cross-node redirect. By default the drag's live override + the
   * committed write both land on the SELECTED node. When this returns
   * another node's id, the editor publishes the override to / commits on
   * THAT node instead (and `apply` should return that node's patch).
   * Used when a node's handle edits a value owned by a sibling — e.g. a
   * downspout's side-move arrows slide its outlet, which lives on the
   * host gutter (`gutter.outlets[].offset`). The selected node is still
   * what `currentValue` / `apply` receive, so the descriptor can read
   * the downspout to find its gutter + outlet.
   */
  overrideTarget?: (node: N, sceneApi: SceneApi) => AnyNodeId | undefined
  min?: number | ((node: N, sceneApi: SceneApi) => number)
  max?: number | ((node: N, sceneApi: SceneApi) => number)
  /** Snap the resized scalar to the editor's active grid step before apply. */
  gridSnap?: boolean
  placement: HandlePlacement<N>
  /**
   * Dimension this handle steers (e.g. `'height'`). When set, the editor
   * publishes it to `activeHandleDrag.label` for the duration of the drag
   * so out-of-band overlays (the floating dimension pill) can react, and
   * the handle's own in-world value chip is suppressed to avoid showing
   * the same number twice. Leave unset for handles that keep their inline
   * chip and don't drive any external overlay.
   */
  measureLabel?: string
  /**
   * Defaults to 'self' (arrow lives in the selected node's own mesh).
   * 'parent' uses the parent mesh — used by doors/windows whose handles
   * need to ride the wall's rotation.
   */
  portal?: HandlePortal
  cursor?: Cursor
  /** Optional visual guide shown while the arrow is hovered or dragging. */
  decoration?: HandleDecoration<N>
  /**
   * Visual override. Defaults to the standard chevron arrow.
   *
   * `'tracker'` swaps the chevron for a dashed vertical leader + a small
   * cube at `placement.position`. The leader runs from the floor (local
   * y=0) up to the cube; the cube is the drag target and reuses the same
   * linear-resize drag pipeline as the chevron. Intended for vertical
   * height handles where the dashed leader makes the "this is the wall
   * top" relationship readable at a glance — mirrors the `corner-picker`
   * shape on `tap-action` handles but with a draggable cube instead of a
   * one-tap hex disc. Use with `axis: 'y'`; horizontal axes will render
   * the leader vertically and look wrong.
   */
  shape?: 'arrow' | 'tracker'
  /**
   * Optional override for the bottom Y of the tracker leader. Defaults
   * to 0 (floor of the rideObject's local frame). Use when the value
   * being tracked spans a region that doesn't start at the floor — e.g.
   * a chimney's body height runs from the roof deck up to the body top,
   * so the leader should start at the deck plane and not climb through
   * the roof shell below it. Only consulted when `shape === 'tracker'`.
   */
  trackerBaseY?: (node: N, sceneApi: SceneApi) => number
  /**
   * Stand the chevron blade up into the node's facing plane instead of
   * leaving it flat in the local XZ plane. For an `axis: 'x'` handle on a
   * wall-mounted opening (door / window), the local XZ plane is horizontal,
   * so the default blade is seen edge-on from the front — rotating it 90°
   * about its pointing axis lays it in the wall face (local XY) so it reads
   * face-on toward the camera. Chevron shape only; `axis: 'y'` handles are
   * already stood up unconditionally so this is a no-op for them.
   */
  faceNormal?: boolean
  /**
   * Gate this arrow behind a click-to-latch cube. When set, the arrow is
   * hidden until the user clicks the {@link LatchHandle} cube declaring the
   * same `group` name; clicking the cube again hides it. Lets a node keep a
   * dense cluster (e.g. a dormer's window width/height arrows) collapsed
   * behind a single grip until the user opts in. The latch state is local to
   * the selection and resets when the node is deselected.
   */
  latchGroup?: string
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
  /**
   * Plane the angular drag is measured in:
   *   - 'horizontal' (default): cursor bearing around +Y — whole-node yaw
   *     (floor items, elevator, stair, roof-segment).
   *   - 'node-normal': cursor bearing around the node's local +Z axis, in
   *     the plane perpendicular to it — spins a wall-mounted item flat
   *     against its wall. The descriptor's `apply` writes the roll
   *     component (rotation[2]). The gizmo icon stands up into that plane.
   */
  rotationPlane?: 'horizontal' | 'node-normal'
  /**
   * Pivot point for the angular drag, in the rideObject's local space.
   * The renderer measures cursor angle (atan2 on the drag plane) around
   * this point — descriptors that write `rotation` should anchor it to
   * the node's visual center. Defaults to the rideObject's own origin,
   * which is correct for nodes whose mesh origin coincides with the
   * field they're rotating (roof-segment, elevator). Use this when the
   * node's pose is baked into its geometry (chimney) so the mesh origin
   * sits at the parent frame's origin rather than the rotating shape's
   * center.
   */
  rotationCenter?: (node: N, sceneApi: SceneApi) => readonly [number, number, number]
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
  /**
   * Visual override; defaults to the standard chevron arrow. `'move-cross'`
   * reuses the 4-way move cross — a tap-to-engage grip that hands the node to
   * its move tool (via `onActivate`) instead of running the generic translate
   * drag, so the move tool's own preview / ticker feedback shows up.
   */
  shape?: 'arrow' | 'corner-picker' | 'move-cross'
  /**
   * `shape: 'corner-picker'` only — render the disc and its outer ring as a
   * circle instead of the default hexagon.
   */
  round?: boolean
  /**
   * Required when `shape: 'corner-picker'` — controls the dashed leader's
   * vertical extent. Pure callback so the descriptor doesn't need to
   * import 3D libs.
   */
  nodeHeight?: (node: N) => number
  /**
   * `shape: 'move-cross'` only — tilts the flat cross to lie in the right
   * plane. `'horizontal'` (default) leaves it flat on the floor; `'node-normal'`
   * stands it up against the node's facing plane (a wall face).
   */
  plane?: 'horizontal' | 'node-normal'
  portal?: HandlePortal
  cursor?: Cursor
}

/**
 * Free ground-plane move. Drag the handle and the node slides across the
 * horizontal plane at its base — the renderer raycasts that plane, converts
 * the hit into the node's parent-local frame, and reports the new local XZ
 * (optionally grid-snapped via `snapExtents`) to `apply`. Press-drag-release
 * with the same live-override → commit-on-release flow as the resize / rotate
 * handles. Rendered as a 4-way cross of double-headed arrows. Pure translation
 * does not require geometry dirtying; renderers consume the live position
 * override directly.
 */
export type TranslateHandle<N = any> = {
  kind: 'translate'
  placement: HandlePlacement<N>
  /**
   * Plane the drag is constrained to (through the node origin):
   *   - 'horizontal' (default): the ground plane (world-up normal) — slide
   *     across the floor. The free axes are parent-local X / Z.
   *   - 'node-normal': the plane perpendicular to the node's local +Z axis
   *     (its facing direction) — slide across a wall face. The free axes are
   *     parent-local X / Y; depth (Z) stays pinned to the surface.
   */
  plane?: 'horizontal' | 'node-normal'
  /**
   * `localPos` is the dragged-to position in the node's PARENT-local frame,
   * with the two in-plane axes already grid-snapped (if `snapExtents` is set)
   * and the off-plane axis pinned to its drag-start value. Return the patch
   * that writes it to the node's position field.
   */
  apply: (
    initialNode: N,
    localPos: readonly [number, number, number],
    sceneApi: SceneApi,
  ) => Partial<N>
  /**
   * Optional grid-snap footprint for the two in-plane axes, in order
   * `[alongX, alongOther]` — `alongOther` is Z for the 'horizontal' plane and
   * Y for 'node-normal'. Used to align the node's edges to the grid (rotation-
   * aware: swap the pair at 90°). Omit / return null for free movement.
   * `sceneApi` is supplied for composite nodes whose footprint depends on
   * children, such as straight stairs.
   */
  snapExtents?: (node: N, sceneApi: SceneApi) => readonly [number, number] | null
  portal?: HandlePortal
}

/**
 * Click-to-latch cube. Renders a small persistent cube at `placement` that
 * toggles the visibility of every handle tagged with the matching
 * {@link LinearResizeHandle.latchGroup} `group`. Clicking the cube once shows
 * the group's arrows; clicking again hides them. The latch state is local to
 * the current selection and resets on deselect.
 *
 * Mirrors the duct-fitting selection cube but driven by descriptor data so any
 * node can collapse a dense arrow cluster behind one grip — e.g. a dormer's
 * window width/height arrows latch behind a cube at the window center.
 */
export type LatchHandle<N = any> = {
  kind: 'latch'
  /** The `latchGroup` name whose arrows this cube reveals / hides. */
  group: string
  placement: HandlePlacement<N>
  portal?: HandlePortal
}

export type HandleDescriptor<N = any> =
  | LinearResizeHandle<N>
  | RadialResizeHandle<N>
  | ArcResizeHandle<N>
  | EndpointMoveHandle<N>
  | TapActionHandle<N>
  | TranslateHandle<N>
  | LatchHandle<N>

/**
 * Static array, or a function for shape-dependent cases (column
 * crossSection / supportStyle, stair-segment segmentType, etc.).
 */
export type HandleList<N> = HandleDescriptor<N>[] | ((node: N) => HandleDescriptor<N>[])
