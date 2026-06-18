// Repairs scene-graph corruption that pre-dates the source fixes, so existing
// saved scenes still load. Two known kinds of damage, both produced by the
// capture wall-merge before it was fixed:
//
//  1. A `children` array containing a non-string entry. The merge re-attached a
//     wall-hosted item without minting an id, so `undefined` was pushed into the
//     wall's children — which serializes to `[null]`. The wall schema rejects
//     `null` children, so the whole scene fails to load.
//  2. A zero-length wall (start === end). It renders nothing, but lingers as a
//     junk node and is a foot-gun for snapping/mitering.
//
// Both are also prevented at the source now (see merge-walls.ts and the wall
// miter limit); this is the load-time safety net for already-saved scenes.

const ZERO_LENGTH_EPS = 1e-6

export interface HealSceneResult {
  nodes: Record<string, unknown>
  /** Ids of zero-length walls that were dropped. */
  droppedWallIds: string[]
  /** Count of non-string (e.g. null) entries removed from `children` arrays. */
  strippedChildRefs: number
}

function isWallLike(node: unknown): node is { start: [number, number]; end: [number, number] } {
  if (!node || typeof node !== 'object') return false
  const n = node as Record<string, unknown>
  return (
    n.type === 'wall' &&
    Array.isArray(n.start) &&
    Array.isArray(n.end) &&
    typeof n.start[0] === 'number' &&
    typeof n.start[1] === 'number' &&
    typeof n.end[0] === 'number' &&
    typeof n.end[1] === 'number'
  )
}

/**
 * Returns a healed copy of a `nodes` map. Pure — does not mutate `input`.
 * Nodes that need no repair are passed through by reference.
 */
export function healSceneNodes(input: Record<string, unknown>): HealSceneResult {
  const droppedWallIds: string[] = []

  // Pass 1: drop childless zero-length walls. (Only childless ones — a wall
  // carrying a door/window must keep its hosts, degenerate or not.)
  const kept: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(input)) {
    if (isWallLike(node)) {
      const children = (node as { children?: unknown }).children
      const childless = !Array.isArray(children) || children.length === 0
      const dx = node.end[0] - node.start[0]
      const dz = node.end[1] - node.start[1]
      if (childless && Math.hypot(dx, dz) <= ZERO_LENGTH_EPS) {
        droppedWallIds.push(id)
        continue
      }
    }
    kept[id] = node
  }

  const dropped = new Set(droppedWallIds)
  let strippedChildRefs = 0

  // Pass 2: clean `children` arrays — drop non-string entries (the `[null]` bug)
  // and references to walls we just removed.
  const nodes: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(kept)) {
    const children = (node as { children?: unknown })?.children
    if (Array.isArray(children)) {
      const cleaned = children.filter((c): c is string => typeof c === 'string' && !dropped.has(c))
      if (cleaned.length !== children.length) {
        strippedChildRefs += children.length - cleaned.length
        nodes[id] = { ...(node as Record<string, unknown>), children: cleaned }
        continue
      }
    }
    nodes[id] = node
  }

  return { nodes, droppedWallIds, strippedChildRefs }
}
