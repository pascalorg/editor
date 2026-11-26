import { type AnyNode, type AnyNodeId, LawnNode, type SceneApi } from '@pascal-app/core'
import { addSiteSurface } from '@pascal-app/core/agent-operations'
import { commitSiteOperationPlacement, snapSitePoint } from '../shared/site-placement'

export const snapLawnPoint = snapSitePoint

export function placeLawn(
  sceneApi: SceneApi,
  polygon: [number, number][],
  select: (id: AnyNodeId) => void,
  siteId?: string,
  onRefusal?: (message: string) => void,
): AnyNodeId | null {
  const nodes: Readonly<Record<string, AnyNode | undefined>> = sceneApi.nodes()
  let resolvedId: AnyNodeId | null = null
  return commitSiteOperationPlacement({
    sceneApi,
    label: 'Lawn placement',
    run: () =>
      addSiteSurface(sceneApi.nodes(), { kind: 'lawn', polygon, siteId }, { activeLevelId: null }),
    parseNode: (node) => {
      const lawn = LawnNode.parse(node)
      const parent = lawn.parentId ? nodes[lawn.parentId] : undefined
      if (parent?.type !== 'site') throw new Error('Lawn placement returned no owning Site.')
      resolvedId = lawn.id
      return lawn
    },
    selectId: (result) => {
      const id = (result.lawnId as AnyNodeId | undefined) ?? null
      if (!id) throw new Error('Lawn placement returned no lawn.')
      return id
    },
    select: (id) => {
      if (resolvedId && id !== resolvedId) throw new Error('Lawn placement returned no lawn.')
      select(id)
    },
    onRefusal: (error) => onRefusal?.(error.message),
  })
}
