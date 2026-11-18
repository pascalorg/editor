import { type AnyNode, type AnyNodeId, LawnNode, type SceneApi } from '@pascal-app/core'
import { addSiteSurface } from '@pascal-app/core/agent-operations'
import { isAgentRefusal } from '@pascal-app/core/agent-tools'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'

export function snapLawnPoint(point: [number, number], force = false): [number, number] {
  const step = !force && isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

export function placeLawn(
  sceneApi: SceneApi,
  polygon: [number, number][],
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
): AnyNodeId | null {
  if (!sceneApi.applyChanges) throw new Error('Lawn placement requires atomic scene changes.')
  try {
    const { result, changes } = addSiteSurface(
      sceneApi.nodes(),
      { kind: 'lawn', polygon, siteId },
      { activeLevelId: null },
    )
    const nodes: Readonly<Record<string, AnyNode | undefined>> = sceneApi.nodes()
    const created = changes?.create?.map(({ node }) => {
      const lawn = LawnNode.parse(node)
      const parent = lawn.parentId ? nodes[lawn.parentId] : undefined
      if (parent?.type !== 'site') throw new Error('Lawn placement returned no owning Site.')
      return { node: lawn, parentId: parent.id }
    })
    const lawn = created?.[0]?.node
    if (!lawn || result.lawnId !== lawn.id) throw new Error('Lawn placement returned no lawn.')
    sceneApi.applyChanges({ create: created })
    select(lawn.id)
    return lawn.id
  } catch (error) {
    if (!isAgentRefusal(error)) throw error
    onRefusal?.(error.message)
    return null
  }
}
