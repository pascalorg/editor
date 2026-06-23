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

export type InteractionView = '2d' | '3d'

// Endpoint/curve/hole/boundary edits are all "reshape the selected node" — one
// node, one in-flight reshape. Grouping them as sub-states of `reshaping`
// (rather than four sibling scopes) keeps the union small while still making
// "curving and hole-editing at once" unrepresentable.
export type ReshapeKind = 'curve' | 'hole' | 'endpoint' | 'boundary'

export type InteractionScope =
  | { kind: 'idle' }
  // Placing a fresh node (catalog/preset/build tool). `pressDrag` is the
  // gizmo press-drag flavour (commit on release) vs click-to-place.
  | {
      kind: 'placing'
      nodeId: string
      nodeType: string
      view: InteractionView
      pressDrag: boolean
    }
  // Moving an existing node.
  | { kind: 'moving'; nodeId: string; nodeType: string; view: InteractionView }
  // Dragging a resize/translate/rotate handle of a selected node.
  | { kind: 'handle-drag'; nodeId: string; handle: string }
  // Click-to-click drafting of a polyline/polygon kind (wall/fence/slab/…).
  | { kind: 'drafting'; tool: string }
  // Reshaping a selected node's geometry (see ReshapeKind).
  | { kind: 'reshaping'; nodeId: string; reshape: ReshapeKind; holeIndex?: number }
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

// Selection/hover picking is only meaningful while idle. During any active
// interaction the pointer belongs to that interaction's body, not to selecting
// a different object — the picking choke point should not route a hover/click
// to selection while this is false.
export function selectionEnabled(scope: InteractionScope): boolean {
  return scope.kind === 'idle'
}
