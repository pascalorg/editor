import {
  type FloorplanMoveTarget,
  TreeNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { snapSiteCursorValue, wrapSiteFloorplanMoveTarget } from '../shared/site-floorplan-move'
import { isTreePositionAllowed } from './movement'

export function clearTreeMovePreview(id: TreeNode['id']): void {
  useLiveNodeOverrides.getState().clear(id)
  useScene.getState().markDirty(id)
}

/** Both movers preview in Site metres and re-read footprints immediately before the one write. */
export const createTreeMoveSession: FloorplanMoveTarget<TreeNode> = ({ node }) => {
  const resolveCursor = createFloorplanCursorResolver({
    original: [node.position[0], node.position[2]],
    metadata: node.metadata,
  })
  let position: TreeNode['position'] | null = null
  const canCommit = () => {
    const nodes = useScene.getState().nodes
    const live = nodes[node.id]
    if (!position || live?.type !== 'tree' || live.parentId !== node.parentId) return false
    if (live.position.some((value, index) => value !== node.position[index])) return false
    return isTreePositionAllowed(live, position, nodes)
  }
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      const target = resolveCursor(planPoint, { snap: snapSiteCursorValue(modifiers) })
      const proposed: TreeNode['position'] = [target[0], 0, target[1]]
      if (!TreeNode.safeParse({ ...node, position: proposed }).success) {
        position = null
        clearTreeMovePreview(node.id)
        return
      }
      position = proposed
      useLiveNodeOverrides.getState().set(node.id, { position })
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (!canCommit() || !position) return
      useScene.getState().updateNode(node.id, { position })
      position = null
      clearTreeMovePreview(node.id)
    },
  }
}

/** Ordinary floor plans are building-local; Site plans already use Site XZ. */
export const treeFloorplanMoveTarget: FloorplanMoveTarget<TreeNode> =
  wrapSiteFloorplanMoveTarget(createTreeMoveSession)
