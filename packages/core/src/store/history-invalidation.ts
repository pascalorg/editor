import type { AnyNode, AnyNodeId, WallNode } from '../schema'
import { getAdjacentWallIds } from '../systems/wall/wall-mitering'

export function getHistoryDirtyNodeIds(
  before: Record<string, AnyNode>,
  after: Record<string, AnyNode>,
): Set<AnyNodeId> {
  const dirty = new Set<AnyNodeId>()
  const changedWalls = new Set<string>()
  const changedHosts = new Set<string>()
  const add = (id: string | null | undefined) => {
    if (id && after[id]) dirty.add(id as AnyNodeId)
  }

  const visitChange = (id: string) => {
    const previous = before[id]
    const next = after[id]
    if (previous === next) return
    add(id)
    add(previous?.parentId)
    add(next?.parentId)

    if (previous?.type === 'wall' || next?.type === 'wall') {
      changedWalls.add(id)
      if (
        previous?.type !== 'wall' ||
        next?.type !== 'wall' ||
        previous.thickness !== next.thickness ||
        previous.height !== next.height ||
        previous.curveOffset !== next.curveOffset
      ) {
        changedHosts.add(id)
      }
    }

    if (previous && !next && previous.parentId) {
      const parent = after[previous.parentId]
      // Preserve deletion's sibling refresh for merged geometry consumers.
      if (parent && 'children' in parent && Array.isArray(parent.children)) {
        for (const childId of parent.children) add(childId)
      }
    }
  }

  for (const id in before) visitChange(id)
  for (const id in after) {
    if (!before[id]) visitChange(id)
  }

  if (changedWalls.size === 0) return dirty

  for (const nodes of [before, after]) {
    const wallsByLevel = new Map<string | null, WallNode[]>()
    for (const id of changedWalls) {
      const wall = nodes[id]
      if (wall?.type === 'wall' && !wallsByLevel.has(wall.parentId)) {
        wallsByLevel.set(wall.parentId, [])
      }
    }
    for (const id in nodes) {
      const node = nodes[id]!
      if (node.type === 'wall') {
        wallsByLevel.get(node.parentId)?.push(node)
      }
      if (
        node.parentId &&
        changedHosts.has(node.parentId) &&
        (node.type === 'door' || node.type === 'window' || node.type === 'item')
      ) {
        add(node.id)
      }
    }
    // Former junctions must rebuild too; the viewer only sees the restored layout.
    for (const walls of wallsByLevel.values()) {
      const changed = new Set(walls.filter((wall) => changedWalls.has(wall.id)).map((w) => w.id))
      for (const id of getAdjacentWallIds(walls, changed)) add(id)
    }
  }
  return dirty
}
