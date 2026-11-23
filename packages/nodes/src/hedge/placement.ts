import { type AnyNodeId, HedgeNode, type SceneApi } from '@pascal-app/core'
import { addHedge } from '@pascal-app/core/agent-operations'
import { commitSiteOperationPlacement } from '../shared/site-placement'

type Point = [number, number]

/**
 * Adds a hedge along Site points, through the operation the agents call, and selects it. A line
 * the operation refuses (two points on each other, no Site) places nothing and throws nothing at
 * a pointer handler.
 */
export function placeHedge(
  sceneApi: SceneApi,
  points: Point[],
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
): AnyNodeId | null {
  return commitSiteOperationPlacement({
    sceneApi,
    label: 'Hedge placement',
    run: () =>
      addHedge(
        sceneApi.nodes(),
        { points, siteId, seed: Math.floor(Math.random() * 10_000) },
        { activeLevelId: null },
      ),
    parseNode: (node) => HedgeNode.parse(node),
    selectId: (result) => result.hedgeId as AnyNodeId,
    select,
    onRefusal: (error) => onRefusal?.(error.message),
  })
}
