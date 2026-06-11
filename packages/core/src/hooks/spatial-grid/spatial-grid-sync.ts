import { nodeRegistry } from '../../registry'
import type { AnyNode, AnyNodeId, SlabNode, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import { getFloorPlacedFootprints } from './floor-placed-elevation'
import {
  itemOverlapsPolygon,
  spatialGridManager,
  wallOverlapsPolygon,
} from './spatial-grid-manager'

export function resolveLevelId(node: AnyNode, nodes: Record<string, AnyNode>): string {
  // If the node itself is a level
  if (node.type === 'level') return node.id

  // Walk up parent chain to find level
  // This assumes you track parentId or can derive it
  let current: AnyNode | undefined = node

  while (current) {
    if (current.type === 'level') return current.id
    // Find parent (you might need to add parentId to your schema or derive it)
    if (current.parentId) {
      current = nodes[current.parentId]
    } else {
      current = undefined
    }
  }

  return 'default' // fallback for orphaned items
}

/**
 * Walks the parent chain of `nodeId` and returns the id of the first ancestor
 * whose `type` is `'level'`, or `null` when no level ancestor exists (orphaned
 * node, top-level building node, etc.). Unlike `resolveLevelId`, this variant:
 *
 * - accepts a node **id** rather than a resolved node, saving the caller a
 *   `nodes[id]` lookup when only the id is at hand.
 * - returns `null` instead of the `'default'` fallback, which lets callers
 *   distinguish "genuinely has no level" from "is a level".
 * - has a loop guard (16 iterations) so a corrupt parent-chain cycle cannot
 *   hang the frame loop.
 */
export function findLevelAncestorId(
  nodeId: AnyNodeId,
  nodes: Record<string, AnyNode>,
): string | null {
  let current: AnyNode | undefined = nodes[nodeId]
  let guard = 0
  while (current && guard < 16) {
    if (current.type === 'level') return current.id
    current = current.parentId ? nodes[current.parentId] : undefined
    guard += 1
  }
  return null
}

/**
 * Returns the building id that contains the given level, or `null` if
 * the level is unparented or no enclosing building exists.
 *
 * Most scenes record the relationship via `level.parentId →
 * building.id`, but older serialisations occasionally drop `parentId`
 * even though the building's `children` array still references the
 * level. The fallback scan covers that case.
 *
 * Used by `FloorplanRegistryLayer` to discover building-scoped kinds
 * (`def.floorplanScope === 'building'`) without hardcoding any kind
 * name in the editor layer.
 */
export function resolveBuildingForLevel(
  levelId: AnyNodeId,
  nodes: Record<AnyNodeId, AnyNode>,
): AnyNodeId | null {
  const level = nodes[levelId] as AnyNode | undefined
  if (!level) return null
  const directParent = (level as { parentId?: AnyNodeId | null }).parentId ?? null
  if (directParent) {
    const candidate = nodes[directParent]
    if (candidate?.type === 'building') return candidate.id as AnyNodeId
  }
  for (const candidate of Object.values(nodes)) {
    if (candidate?.type !== 'building') continue
    const children = (candidate as { children?: AnyNodeId[] }).children
    if (Array.isArray(children) && children.includes(levelId)) {
      return candidate.id as AnyNodeId
    }
  }
  return null
}

// Call this once at app initialization. Returns an unsubscribe function that
// detaches the scene-store listener (useful when the editor is unmounted so
// the spatial grid singleton does not hold stale references to old scenes).
export function initSpatialGridSync(): () => void {
  const store = useScene
  // 1. Initial sync - process all existing nodes
  const state = store.getState()
  for (const node of Object.values(state.nodes)) {
    const levelId = resolveLevelId(node, state.nodes)
    spatialGridManager.handleNodeCreated(node, levelId)
  }

  // 2. Then subscribe to future changes
  const markDirty = (id: AnyNodeId) => store.getState().markDirty(id)

  // Subscribe to all changes
  const unsubscribe = store.subscribe((state, prevState) => {
    // Detect added nodes
    for (const [id, node] of Object.entries(state.nodes)) {
      if (!prevState.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, state.nodes)
        spatialGridManager.handleNodeCreated(node, levelId)

        // When a slab is added, mark overlapping items/walls dirty
        if (node.type === 'slab') {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
        }
      }
    }

    // Detect removed nodes
    for (const [id, node] of Object.entries(prevState.nodes)) {
      if (!state.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, prevState.nodes)
        spatialGridManager.handleNodeDeleted(id, node.type, levelId)

        // When a slab is removed, mark items/walls that were on it dirty (using current state)
        if (node.type === 'slab') {
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
        }
      }
    }

    // Detect updated nodes (items with position/rotation/parentId/side changes, slabs with polygon/elevation changes)
    for (const [id, node] of Object.entries(state.nodes)) {
      const prev = prevState.nodes[id as AnyNode['id']]
      if (!prev) continue

      if (node.type === 'item' && prev.type === 'item') {
        if (
          !(
            arraysEqual(node.position, prev.position) &&
            arraysEqual(node.rotation, prev.rotation) &&
            arraysEqual(node.scale, prev.scale)
          ) ||
          node.parentId !== prev.parentId ||
          node.side !== prev.side
        ) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)
          // Scale changes affect footprint size — mark dirty so slab elevation recalculates
          if (!arraysEqual(node.scale, prev.scale)) {
            markDirty(node.id)
          }
        }
      } else if (node.type === 'slab' && prev.type === 'slab') {
        if (
          node.polygon !== prev.polygon ||
          node.elevation !== prev.elevation ||
          node.holes !== prev.holes
        ) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)

          // Mark nodes overlapping old polygon and new polygon as dirty
          markNodesOverlappingSlab(prev as SlabNode, state.nodes, markDirty)
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
        }
      }
    }
  })

  return unsubscribe
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Mark all floor items and walls that may be affected by a slab change as dirty.
 */
function markNodesOverlappingSlab(
  slab: SlabNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  if (slab.polygon.length < 3) return
  const slabLevelId = resolveLevelId(slab, nodes)

  for (const node of Object.values(nodes)) {
    if (node.type === 'wall') {
      const wall = node as WallNode
      if (resolveLevelId(node, nodes) !== slabLevelId) continue
      if (
        wallOverlapsPolygon(
          {
            start: wall.start,
            end: wall.end,
            curveOffset: wall.curveOffset ?? 0,
            thickness: wall.thickness,
          },
          slab.polygon,
        )
      ) {
        markDirty(node.id)
      }
      continue
    }
    // Generic floor-placed sweep: any registry kind that opts in via
    // `capabilities.floorPlaced` (item / shelf / column / spawn / …)
    // re-elevates through `<FloorElevationSystem>` when a slab below
    // changes. We dirty-mark when the kind's footprint overlaps the
    // changed slab so the system picks it up next frame.
    const def = nodeRegistry.get(node.type)
    const floorPlaced = def?.capabilities?.floorPlaced
    if (!floorPlaced) continue
    if (floorPlaced.applies && !floorPlaced.applies(node)) continue
    const parentId = node.parentId as AnyNodeId | null
    const parent = parentId ? nodes[parentId] : null
    if (parent && parent.type !== 'level') continue
    if (resolveLevelId(node, nodes) !== slabLevelId) continue
    const position = (node as { position?: [number, number, number] }).position
    if (!position) continue
    for (const footprint of getFloorPlacedFootprints(floorPlaced, node, { nodes })) {
      if (
        itemOverlapsPolygon(
          footprint.position ?? position,
          footprint.dimensions,
          footprint.rotation,
          slab.polygon,
          0.01,
        )
      ) {
        markDirty(node.id)
        break
      }
    }
  }
}
