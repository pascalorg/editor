import {
  type AnyNodeId,
  type FloorplanMoveTarget,
  PlantingNode,
  plantingAreaOutline,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { isGridSnapActive, useDrawingView, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import { planToSite } from '../shared/site-frame'

type Point = [number, number]

export function translatedPlanting(
  node: PlantingNode,
  dx: number,
  dz: number,
): Partial<PlantingNode> {
  return node.outline
    ? { outline: node.outline.map(([x, z]): Point => [x + dx, z + dz]) }
    : { center: [node.center[0] + dx, node.center[1] + dz] }
}

/** Shared move session in Site metres. Live overrides keep ground and exclusions accurate. */
export const createPlantingMoveSession: FloorplanMoveTarget<PlantingNode> = ({ node }) => {
  const original = node.outline ?? plantingAreaOutline(node.area!, node.center)
  const centre: Point = [
    original.reduce((sum, [x]) => sum + x, 0) / original.length,
    original.reduce((sum, [, z]) => sum + z, 0) / original.length,
  ]
  const resolveCursor = createFloorplanCursorResolver({ original: centre, metadata: node.metadata })
  let patch: Partial<PlantingNode> | null = null
  let proposalValid = true
  const canCommit = () => {
    const live = useScene.getState().nodes[node.id]
    return (
      proposalValid &&
      !!patch &&
      live?.type === 'planting' &&
      live.outline === node.outline &&
      live.area === node.area &&
      live.center === node.center &&
      PlantingNode.safeParse({ ...live, ...patch }).success
    )
  }
  return {
    affectedIds: [node.id],
    apply({ planPoint, modifiers }) {
      const step = !modifiers.altKey && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snap = (value: number) => (step > 0 ? Math.round(value / step) * step : value)
      const target = resolveCursor(planPoint, { snap })
      const [dx, dz] = [target[0] - centre[0], target[1] - centre[1]]
      const proposed = dx || dz ? translatedPlanting(node, dx, dz) : null
      const live = useScene.getState().nodes[node.id]
      proposalValid =
        live?.type === 'planting' && PlantingNode.safeParse({ ...live, ...proposed }).success
      // Builders parse the effective node too: never publish an invalid candidate to them.
      if (!proposalValid) return
      patch = proposed
      if (patch) useLiveNodeOverrides.getState().set(node.id, patch)
      else useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
    },
    canCommit,
    commit() {
      if (!canCommit() || !patch) return
      useScene.getState().updateNode(node.id, patch)
      useLiveNodeOverrides.getState().clear(node.id)
      useScene.getState().markDirty(node.id)
    },
  }
}

/** A rotated building's plan cursor is converted to Site metres before moving its bed. */
export const plantingFloorplanMoveTarget: FloorplanMoveTarget<PlantingNode> = (args) => {
  const session = createPlantingMoveSession(args)
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
