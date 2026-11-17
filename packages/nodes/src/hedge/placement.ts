import { type AnyNodeId, HedgeNode, type SceneApi } from '@pascal-app/core'
import { addHedge } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'

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
  if (!sceneApi.applyChanges) throw new Error('Hedge placement requires atomic scene changes.')
  try {
    const { result, changes } = addHedge(
      sceneApi.nodes(),
      { points, siteId, seed: Math.floor(Math.random() * 10_000) },
      { activeLevelId: null },
    )
    sceneApi.applyChanges({
      create: changes?.create?.map(({ node, parentId }) => ({
        node: HedgeNode.parse(node),
        parentId: parentId as AnyNodeId | undefined,
      })),
    })
    select(result.hedgeId as AnyNodeId)
    return result.hedgeId as AnyNodeId
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    onRefusal?.(error.message)
    return null
  }
}
