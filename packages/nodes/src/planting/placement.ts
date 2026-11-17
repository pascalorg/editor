import { type AnyNodeId, PlantingNode, type SceneApi } from '@pascal-app/core'
import { addPlanting } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'

/** By-hand drawing uses the exact operation and refusals used by chat and MCP. */
export function placePlanting(
  sceneApi: SceneApi,
  outline: [number, number][],
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
): AnyNodeId | null {
  if (!sceneApi.applyChanges) throw new Error('Planting requires atomic scene changes.')
  try {
    const { result, changes } = addPlanting(
      sceneApi.nodes(),
      { outline, siteId, seed: Math.floor(Math.random() * 10_000) },
      { activeLevelId: null },
    )
    sceneApi.applyChanges({
      create: changes?.create?.map(({ node, parentId }) => ({
        node: PlantingNode.parse(node),
        parentId: parentId as AnyNodeId | undefined,
      })),
    })
    const id = result.plantingId as AnyNodeId
    select(id)
    return id
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    onRefusal?.(error.message)
    return null
  }
}
