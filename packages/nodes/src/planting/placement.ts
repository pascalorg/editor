import { type AnyNodeId, PlantingNode, type SceneApi } from '@pascal-app/core'
import { addPlanting } from '@pascal-app/core/agent-operations'
import { commitSiteOperationPlacement } from '../shared/site-placement'

/** By-hand drawing uses the exact operation and refusals used by chat and MCP. */
export function placePlanting(
  sceneApi: SceneApi,
  outline: [number, number][],
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
): AnyNodeId | null {
  return commitSiteOperationPlacement({
    sceneApi,
    label: 'Planting',
    run: () =>
      addPlanting(
        sceneApi.nodes(),
        { outline, siteId, seed: Math.floor(Math.random() * 10_000) },
        { activeLevelId: null },
      ),
    parseNode: (node) => PlantingNode.parse(node),
    selectId: (result) => result.plantingId as AnyNodeId,
    select,
    onRefusal: (error) => onRefusal?.(error.message),
  })
}
