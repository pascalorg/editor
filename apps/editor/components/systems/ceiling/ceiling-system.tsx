import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor from '@/store/use-editor'

export const CeilingSystem = () => {
  const tool = useEditor((state) => state.tool)
  const selectedItem = useEditor((state) => state.selectedItem)
  const movingNode = useEditor((state) => state.movingNode)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  useEffect(() => {
    const shouldShowGrid =
      tool === 'ceiling' ||
      selectedItem?.attachTo === 'ceiling' ||
      (movingNode?.type === 'item' && movingNode?.asset?.attachTo === 'ceiling') ||
      selectedIds.some((id) => {
        const node = useScene.getState().nodes[id as AnyNodeId]
        return node?.type === 'ceiling'
      })
    
    const ceilings = sceneRegistry.byType.ceiling
    ceilings.forEach((ceiling) => {
      const mesh = sceneRegistry.nodes.get(ceiling)
      if (mesh) {
        const ceilingGrid = mesh.getObjectByName('ceiling-grid')
        if (ceilingGrid) {
          ceilingGrid.visible = shouldShowGrid
          ceilingGrid.scale.setScalar(shouldShowGrid ? 1 : 0.0) // Scale down to zero to prevent event interference when grid is hidden
        }
      }
    })
  }, [tool, selectedItem, movingNode, selectedIds])
  return null
}
