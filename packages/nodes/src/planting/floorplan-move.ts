import {
  type FloorplanMoveTarget,
  PlantingNode,
  plantingAreaOutline,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { createFloorplanCursorResolver } from '../shared/floorplan-cursor'
import {
  sitePointsCenter,
  snapSiteCursorValue,
  wrapSiteFloorplanMoveTarget,
} from '../shared/site-floorplan-move'

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
  const centre = sitePointsCenter(original)
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
      const target = resolveCursor(planPoint, { snap: snapSiteCursorValue(modifiers) })
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
export const plantingFloorplanMoveTarget: FloorplanMoveTarget<PlantingNode> =
  wrapSiteFloorplanMoveTarget(createPlantingMoveSession)
