import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  HedgeNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { planToSite } from '../shared/site-frame'

type Point = [number, number]

/** Rebuild on the proposed ground instead of translating vertices from the old ground. */
export const createHedgeMoveSession: FloorplanMoveTarget<HedgeNode> = ({ node }) => {
  const centre: Point = [
    node.path.reduce((sum, [x]) => sum + x, 0) / node.path.length,
    node.path.reduce((sum, [, z]) => sum + z, 0) / node.path.length,
  ]
  const resolveCursor = createFloorplanCursorResolver({ original: centre, metadata: node.metadata })
  let path: Point[] | null = null
  let proposalValid = true
  const canCommit = () => {
    const live = useScene.getState().nodes[node.id]
    return (
      proposalValid &&
      !!path &&
      live?.type === 'hedge' &&
      live.path === node.path &&
      HedgeNode.safeParse({ ...live, path }).success
    )
  }
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      const step = !modifiers.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      const target = resolveCursor(planPoint, { snap })
      const [dx, dz] = [target[0] - centre[0], target[1] - centre[1]]
      const proposed = dx || dz ? node.path.map(([x, z]): Point => [x + dx, z + dz]) : null
      const live = useScene.getState().nodes[node.id]
      proposalValid =
        live?.type === 'hedge' &&
        HedgeNode.safeParse({ ...live, path: proposed ?? node.path }).success
      if (!proposalValid) return
      path = proposed
      if (path) useLiveNodeOverrides.getState().set(node.id, { path })
      else useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (!canCommit() || !path) return
      useScene.getState().updateNode(node.id, { path })
      useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
    },
  }
}

/** Floor-plan coordinates follow the active building; a site plan already uses Site metres. */
export const hedgeFloorplanMoveTarget: FloorplanMoveTarget<HedgeNode> = (args) => {
  const session = createHedgeMoveSession(args)
  const levelId = useViewer.getState().selection.levelId
  const level = levelId ? args.nodes[levelId] : undefined
  const parent = level?.parentId ? args.nodes[level.parentId as AnyNodeId] : undefined
  const building =
    parent?.type === 'building' && parent.parentId === args.node.parentId ? parent : null
  return {
    ...session,
    apply({ planPoint, modifiers }) {
      session.apply({
        planPoint: planToSite(
          useDrawingView.getState().drawingType === 'site-plan' ? null : building,
          [planPoint[0], planPoint[1]],
        ),
        modifiers,
      })
    },
  }
}
