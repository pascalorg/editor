// Repairs scene-graph corruption that pre-dates the source fixes, so existing
// saved scenes still load. Known kinds of damage:
//
//  1. A `children` array containing a non-string entry. The capture wall-merge
//     re-attached a wall-hosted item without minting an id, so `undefined` was
//     pushed into the wall's children — which serializes to `[null]`. The wall
//     schema rejects `null` children, so the whole scene fails to load.
//  2. A zero-length wall (start === end). It renders nothing, but lingers as a
//     junk node and is a foot-gun for snapping/mitering.
//  3. A child referenced by a parent it no longer belongs to: the child's
//     `parentId` points at node B while node A's `children` still lists it
//     (stale leftover from a reparent that didn't clean the old parent). The
//     duplicate reference renders the child twice (duplicate React keys in the
//     2D plan, doubled hosted geometry in 3D). Same-array duplicates are
//     collapsed too.
//  4. A node with a null `parentId` that exactly one parent still claims via
//     `children` (the legacy site-child flatten and the old default-scene
//     assembler both linked children without writing `parentId`). The editor
//     renders the chain through `children`, but the hosted scene authority
//     validates parent/child symmetry and rejects the whole scene.
//
// All are also prevented at the source now; this is the load-time safety net
// for already-saved scenes.

import { AnyNode, nodeKindOf } from '../schema/types'
import { healScenePlanCoordinates } from './heal-plan-coordinates'

const ZERO_LENGTH_EPS = 1e-6
const hostKinds = new Set<string>(
  AnyNode.options.filter((schema) => 'children' in schema.shape).map(nodeKindOf),
)

export interface HealSceneResult {
  /** Ids of zero-length walls that were dropped. */
  droppedWallIds: string[]
  nodes: Record<string, unknown>
  repairedCoordinates: number
  /**
   * Ids of nodes whose null `parentId` was repaired to the one parent that
   * still claims them via `children`.
   */
  repairedParentLinkNodeIds: string[]
  repairedChildLinkNodeIds: string[]
  /** Count of invalid non-string (e.g. null) entries removed from `children` arrays. */
  strippedChildRefs: number
  /**
   * Count of child references removed because the child's `parentId` points at
   * a different node (stale reparent leftovers), plus same-array duplicates.
   */
  strippedStaleChildRefs: number
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
  const repairedChildLinkNodeIds: string[] = []
  let repairedCoordinates = 0

  // Pass 1: drop childless zero-length walls. (Only childless ones — a wall
  // carrying a door/window must keep its hosts, degenerate or not.)
  const kept: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(healScenePlanCoordinates(input))) {
    if (node !== input[id]) repairedCoordinates += 1
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
  let strippedStaleChildRefs = 0

  // Pass 2: clean `children` arrays — drop invalid non-string entries (the
  // `[null]` bug), references to walls we just removed, same-array duplicates,
  // and stale references whose child's `parentId` names a different parent.
  // Legacy sites embedded full child objects; keep those for migrateNodes to
  // flatten after healing instead of disconnecting the entire building.
  const cleanedNodes: Record<string, unknown> = {}
  for (const [id, node] of Object.entries(kept)) {
    const children = (node as { children?: unknown })?.children
    if ((node as { type?: unknown })?.type === 'level' && !Array.isArray(children)) {
      cleanedNodes[id] = {
        ...(node as Record<string, unknown>),
        children: Object.entries(kept)
          .filter(([, child]) => (child as { parentId?: unknown })?.parentId === id)
          .map(([childId]) => childId),
      }
      repairedChildLinkNodeIds.push(id)
      continue
    }
    if (Array.isArray(children)) {
      const seen = new Set<string>()
      const cleaned = children.filter((child) => {
        const embeddedSiteChildId =
          (node as { type?: unknown }).type === 'site' &&
          child &&
          typeof child === 'object' &&
          typeof (child as { id?: unknown }).id === 'string'
            ? (child as { id: string }).id
            : null
        if (embeddedSiteChildId) {
          if (seen.has(embeddedSiteChildId)) {
            strippedStaleChildRefs++
            return false
          }
          seen.add(embeddedSiteChildId)
          return true
        }
        if (typeof child !== 'string' || dropped.has(child)) {
          strippedChildRefs++
          return false
        }
        if (seen.has(child)) {
          strippedStaleChildRefs++
          return false
        }
        seen.add(child)
        const childNode = kept[child] as { parentId?: unknown } | undefined
        if (childNode && typeof childNode.parentId === 'string' && childNode.parentId !== id) {
          strippedStaleChildRefs++
          return false
        }
        return true
      })
      if (cleaned.length !== children.length) {
        cleanedNodes[id] = { ...(node as Record<string, unknown>), children: cleaned }
        continue
      }
    }
    cleanedNodes[id] = node
  }

  // Pass 3: repair null parent links (`repairClaimedParentLinks`).
  const { nodes, repairedParentLinkNodeIds } = repairClaimedParentLinks(cleanedNodes)

  // Reachability follows children, so retaining a node via parentId also
  // requires repairing its host's reverse link before authority validation.
  for (const [id, node] of Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b))) {
    const parentId = (node as { parentId?: unknown })?.parentId
    if (typeof parentId !== 'string' || parentId === id) continue
    const parent = nodes[parentId] as { type?: string; children?: unknown } | undefined
    if (!parent || !(hostKinds.has(parent.type ?? '') || Array.isArray(parent.children))) continue
    const children = Array.isArray(parent.children) ? parent.children : []
    if (
      children.some(
        (child) => child === id || (child && typeof child === 'object' && child.id === id),
      )
    )
      continue
    nodes[parentId] = { ...parent, children: [...children, id] }
    if (!repairedChildLinkNodeIds.includes(parentId)) repairedChildLinkNodeIds.push(parentId)
  }

  return {
    nodes,
    repairedCoordinates,
    droppedWallIds,
    strippedChildRefs,
    strippedStaleChildRefs,
    repairedParentLinkNodeIds,
    repairedChildLinkNodeIds,
  }
}

/**
 * Pass 3 of `healSceneNodes`, on its own for loaders that must not run the
 * other repairs: a node with a null `parentId` that exactly one parent claims
 * via `children` gets that `parentId`. Legacy writers (the hosted MCP's
 * default scene until 2026-10) linked `children` without writing `parentId`.
 * Embedded legacy site children claim by their `id`, so the flattened node is
 * repaired too. Pure: nodes that need no repair are passed through by reference.
 */
export function repairClaimedParentLinks(input: Record<string, unknown>): {
  nodes: Record<string, unknown>
  repairedParentLinkNodeIds: string[]
} {
  const nodes = { ...input }
  const claimantsByChildId = new Map<string, string[]>()
  for (const [id, node] of Object.entries(nodes)) {
    const children = (node as { children?: unknown })?.children
    if (!Array.isArray(children)) continue
    for (const child of children) {
      const childId =
        typeof child === 'string'
          ? child
          : child && typeof child === 'object' && typeof (child as { id?: unknown }).id === 'string'
            ? (child as { id: string }).id
            : null
      if (!(childId && childId in nodes)) continue
      const claimants = claimantsByChildId.get(childId) ?? []
      claimants.push(id)
      claimantsByChildId.set(childId, claimants)
    }
  }

  const repairedParentLinkNodeIds: string[] = []
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') continue
    if ((node as { parentId?: unknown }).parentId != null) continue
    const claimants = claimantsByChildId.get(id)
    if (claimants?.length !== 1 || claimants[0] === id) continue
    nodes[id] = { ...(node as Record<string, unknown>), parentId: claimants[0] }
    repairedParentLinkNodeIds.push(id)
  }
  return { nodes, repairedParentLinkNodeIds }
}
