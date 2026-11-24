import {
  type FloorplanMoveTarget,
  HedgeNode,
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

/** Rebuild on the proposed ground instead of translating vertices from the old ground. */
export const createHedgeMoveSession: FloorplanMoveTarget<HedgeNode> = ({ node }) => {
  const centre = sitePointsCenter(node.path)
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
      const target = resolveCursor(planPoint, { snap: snapSiteCursorValue(modifiers) })
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
export const hedgeFloorplanMoveTarget: FloorplanMoveTarget<HedgeNode> =
  wrapSiteFloorplanMoveTarget(createHedgeMoveSession)
