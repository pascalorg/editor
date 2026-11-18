import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  TreeNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { planToSite } from '../shared/site-frame'
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
      const step = !modifiers.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      const target = resolveCursor(planPoint, { snap })
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
export const treeFloorplanMoveTarget: FloorplanMoveTarget<TreeNode> = (args) => {
  const session = createTreeMoveSession(args)
  const levelId = useViewer.getState().selection.levelId
  const level = levelId ? args.nodes[levelId] : undefined
  const parent = level?.parentId ? args.nodes[level.parentId as AnyNodeId] : undefined
  const building =
    parent?.type === 'building' && parent.parentId === args.node.parentId ? parent : null
  return {
    ...session,
    apply({ planPoint, modifiers }) {
      const point = planToSite(
        useDrawingView.getState().drawingType === 'site-plan' ? null : building,
        [planPoint[0], planPoint[1]],
      )
      session.apply({ planPoint: point, modifiers })
    },
  }
}
