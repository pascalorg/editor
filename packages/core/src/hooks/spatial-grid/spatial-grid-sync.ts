import type { AnyNode } from '../../schema'
import useScene from '../../store/use-scene'
import { spatialGridManager } from './spatial-grid-manager'

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

  // Subscribe to all changes
  store.subscribe((state, prevState) => {
    // Detect added nodes
    for (const [id, node] of Object.entries(state.nodes)) {
      if (!prevState.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, state.nodes)
        spatialGridManager.handleNodeCreated(node, levelId)
      }
    }

    // Detect removed nodes
    for (const [id, node] of Object.entries(prevState.nodes)) {
      if (!state.nodes[id as AnyNode['id']]) {
        const levelId = resolveLevelId(node, prevState.nodes)
        spatialGridManager.handleNodeDeleted(id, node.type, levelId)
      }
    }

    // Detect updated nodes (items with position/rotation/parentId/side changes)
    for (const [id, node] of Object.entries(state.nodes)) {
      const prev = prevState.nodes[id as AnyNode['id']]
      if (prev && node.type === 'item' && prev.type === 'item') {
        if (
          !arraysEqual(node.position, prev.position) ||
          !arraysEqual(node.rotation, prev.rotation) ||
          node.parentId !== prev.parentId ||
          node.side !== prev.side
        ) {
          const levelId = resolveLevelId(node, state.nodes)
          spatialGridManager.handleNodeUpdated(node, levelId)
        }
      }
    }
  })
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
