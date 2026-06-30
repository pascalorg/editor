// The authoritative description of "what the user is currently doing".
//
// Before this, that question was answered by re-deriving from 7+ independent
// `useEditor` flags (`mode`, `tool`, `movingNode`, `placementDragMode`,
// `activeHandleDrag`, `curvingWall`, `curvingFence`, `editingHole`,
// `movingWallEndpoint`, `movingFenceEndpoint`, …). Every overlay and pick site
// re-derived its behaviour from a different subset, so the flags could drift
// into illegal combinations (moving + curving at once; a stale `movingNode`
// after a drag ended). Collapsing them into one discriminated union makes those
// combinations unrepresentable: a scope is exactly one interaction at a time,
// and `idle` carries no interaction payload at all.

import type { AnyNode } from '@pascal-app/core'

export type InteractionView = '2d' | '3d'

// Endpoint/curve/hole/boundary edits are all "reshape the selected node" — one
// node, one in-flight reshape. Grouping them as sub-states of `reshaping`
// (rather than four sibling scopes) keeps the union small while still making
// "curving and hole-editing at once" unrepresentable.
export type ReshapeKind = 'curve' | 'hole' | 'endpoint' | 'boundary' | 'control-point' | 'tangent'

export type InteractionScope =
  | { kind: 'idle' }
  // Placing a fresh node (catalog/preset/build tool). `pressDrag` is the
  // gizmo press-drag flavour (commit on release) vs click-to-place.
  | {
      kind: 'placing'
      // The node being placed, carried inline: a fresh-placement / duplicate
      // draft is not in the scene yet, so it cannot be recovered by id. Set once
      // at `begin` and never mutated, so it is a stable reference for the gesture.
      node: AnyNode
      nodeId: string
      nodeType: string
      view: InteractionView
      pressDrag: boolean
    }
  // Moving an existing node.
  | { kind: 'moving'; node: AnyNode; nodeId: string; nodeType: string; view: InteractionView }
  // Dragging a resize/translate/rotate handle of a selected node.
  | { kind: 'handle-drag'; nodeId: string; handle: string }
  // Click-to-click drafting of a polyline/polygon kind (wall/fence/slab/…).
  | { kind: 'drafting'; tool: string }
  // Reshaping a selected node's geometry (see ReshapeKind). `holeIndex` is set
  // only for `reshape: 'hole'`; `endpoint` only for `reshape: 'endpoint'`.
  | {
      kind: 'reshaping'
      nodeId: string
      reshape: ReshapeKind
      holeIndex?: number
      endpoint?: 'start' | 'end'
      index?: number
      side?: 'in' | 'out'
    }
  // Marquee selection drag.
  | { kind: 'box-select' }
  // Material paint application.
  | { kind: 'painting' }

export type InteractionKind = InteractionScope['kind']

export type ActiveInteractionScope = Exclude<InteractionScope, { kind: 'idle' }>

export const IDLE_SCOPE: InteractionScope = { kind: 'idle' }

export function isIdle(scope: InteractionScope): scope is { kind: 'idle' } {
  return scope.kind === 'idle'
}

export function isActive(scope: InteractionScope): scope is ActiveInteractionScope {
  return scope.kind !== 'idle'
}

// The node a scope is acting on, if any. Drafting/box-select/painting/idle
// target no single existing node.
export function scopeNodeId(scope: InteractionScope): string | null {
  switch (scope.kind) {
    case 'placing':
    case 'moving':
    case 'handle-drag':
    case 'reshaping':
      return scope.nodeId
    default:
      return null
  }
}

// The node a placing/moving scope is acting on, carried inline (see the
// `placing` variant comment). Null for every other scope. Replaces the legacy
// `useEditor.movingNode` flag: the node lives inside the discriminated union, so
// it cannot survive past the interaction's `end()`.
export function movingNodeOf(scope: InteractionScope): AnyNode | null {
  return scope.kind === 'placing' || scope.kind === 'moving' ? scope.node : null
}

// Selection/hover picking is only meaningful while idle. During any active
// interaction the pointer belongs to that interaction's body, not to selecting
// a different object — the picking choke point should not route a hover/click
// to selection while this is false.
export function selectionEnabled(scope: InteractionScope): boolean {
  return scope.kind === 'idle'
}

// Derived views of the scope that mirror the legacy `useEditor` flags they
// replaced. Each returns null unless that exact interaction is active, so a
// stale payload is unrepresentable: the value is a pure function of the single
// authoritative scope, not an independent flag that can drift out of sync.

// The legacy `activeHandleDrag` flag. `label` keeps the legacy field name so
// downstream `=== ROTATE_HANDLE_DRAG_LABEL` / `=== 'height'` checks are unchanged.
export function handleDragInfo(scope: InteractionScope): { nodeId: string; label: string } | null {
  return scope.kind === 'handle-drag' ? { nodeId: scope.nodeId, label: scope.handle } : null
}

// The legacy `editingHole` flag (`SurfaceHoleTarget`).
export function editingHoleInfo(
  scope: InteractionScope,
): { nodeId: string; holeIndex: number } | null {
  return scope.kind === 'reshaping' && scope.reshape === 'hole' && scope.holeIndex !== undefined
    ? { nodeId: scope.nodeId, holeIndex: scope.holeIndex }
    : null
}

// Build the scope payload for a hole reshape, so producers don't re-spell the
// discriminator at every call site.
export function holeEditScope(target: {
  nodeId: string
  holeIndex: number
}): ActiveInteractionScope {
  return {
    kind: 'reshaping',
    nodeId: target.nodeId,
    reshape: 'hole',
    holeIndex: target.holeIndex,
  }
}

// True while the selected node's geometry is being curved (legacy
// `curvingWall` / `curvingFence` — now one scope; the wall-vs-fence kind is
// recovered from the reshaped node's type, looked up from the scene by nodeId).
export function isCurveReshape(scope: InteractionScope): boolean {
  return scope.kind === 'reshaping' && scope.reshape === 'curve'
}

// The legacy `movingWallEndpoint` / `movingFenceEndpoint` flags minus the node
// itself (consumers fetch the node from the scene by `nodeId`; it is stable for
// the duration of the drag).
export function endpointReshapeInfo(
  scope: InteractionScope,
): { nodeId: string; endpoint: 'start' | 'end' } | null {
  return scope.kind === 'reshaping' && scope.reshape === 'endpoint' && scope.endpoint !== undefined
    ? { nodeId: scope.nodeId, endpoint: scope.endpoint }
    : null
}

export function controlPointReshapeInfo(
  scope: InteractionScope,
): { nodeId: string; index: number } | null {
  return scope.kind === 'reshaping' &&
    scope.reshape === 'control-point' &&
    scope.index !== undefined
    ? { nodeId: scope.nodeId, index: scope.index }
    : null
}

export function tangentReshapeInfo(
  scope: InteractionScope,
): { nodeId: string; index: number; side: 'in' | 'out' } | null {
  return scope.kind === 'reshaping' &&
    scope.reshape === 'tangent' &&
    scope.index !== undefined &&
    scope.side !== undefined
    ? { nodeId: scope.nodeId, index: scope.index, side: scope.side }
    : null
}

// The id of the node being reshaped (any reshape kind), for the scene lookup
// that recovers the full node payload a few consumers still need.
export function reshapingNodeId(scope: InteractionScope): string | null {
  return scope.kind === 'reshaping' ? scope.nodeId : null
}

// Builders so producers don't re-spell the discriminator at every call site.
export function curveReshapeScope(nodeId: string): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'curve' }
}

export function endpointReshapeScope(
  nodeId: string,
  endpoint: 'start' | 'end',
): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'endpoint', endpoint }
}

export function controlPointReshapeScope(nodeId: string, index: number): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'control-point', index }
}

export function tangentReshapeScope(
  nodeId: string,
  index: number,
  side: 'in' | 'out',
): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'tangent', index, side }
}

// Dragging a polygon vertex/edge (slab / ceiling boundary). Drives the snapping
// HUD (no-angle 'polygon' set) and keeps the idle select hints off-screen.
export function boundaryReshapeScope(nodeId: string): ActiveInteractionScope {
  return { kind: 'reshaping', nodeId, reshape: 'boundary' }
}
