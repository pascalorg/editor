import type { AnyNode, AnyNodeId, ItemNode, SlabNode, WallNode } from '../../schema'
import useScene from '../../store/use-scene'
import { itemOverlapsPolygon, spatialGridManager, wallOverlapsPolygon } from './spatial-grid-manager'

export function resolveLevelId(node: AnyNode, nodes: Record<string, AnyNode>): string {
  // If the node itself is a level
  if (node.type === 'level') return node.id

  // Walk up parent chain to find level
  // This assumes you track parentId or can derive it
  let current: AnyNode | undefined = node

  while (current) {
    if (current.type === 'level') return current.id
    // Find parent (you might need to add parentId to your schema or derive it)
    if (!current.parentId) {
      current = undefined
    } else {
      current = nodes[current.parentId]
    }
  }

  return 'default' // fallback for orphaned items
}

// Call this once at app initialization
export function initSpatialGridSync() {
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
  store.subscribe((state, prevState) => {
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
          !arraysEqual(node.position, prev.position) ||
          !arraysEqual(node.rotation, prev.rotation) ||
          node.parentId !== prev.parentId ||
          node.side !== prev.side
        ) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)
        }
      } else if (node.type === 'slab' && prev.type === 'slab') {
        if (node.polygon !== prev.polygon || node.elevation !== prev.elevation) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)

          // Mark nodes overlapping old polygon and new polygon as dirty
          markNodesOverlappingSlab(prev as SlabNode, state.nodes, markDirty)
          markNodesOverlappingSlab(node as SlabNode, state.nodes, markDirty)
        }
      }
    }
  })
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Mark all floor items and walls that overlap a slab polygon as dirty.
 */
function markNodesOverlappingSlab(
  slab: SlabNode,
  nodes: Record<string, AnyNode>,
  markDirty: (id: AnyNodeId) => void,
) {
  if (slab.polygon.length < 3) return
  const slabLevelId = resolveLevelId(slab, nodes)

  for (const node of Object.values(nodes)) {
    if (node.type === 'item') {
      const item = node as ItemNode
      // Only floor items are affected by slabs
      if (item.asset.attachTo) continue
      if (resolveLevelId(node, nodes) !== slabLevelId) continue
      if (itemOverlapsPolygon(item.position, item.asset.dimensions, item.rotation, slab.polygon, 0.01)) {
        markDirty(node.id)
      }
    } else if (node.type === 'wall') {
      const wall = node as WallNode
      if (resolveLevelId(node, nodes) !== slabLevelId) continue
      if (wallOverlapsPolygon(wall.start, wall.end, slab.polygon)) {
        markDirty(node.id)
      }
    }
  }
}
