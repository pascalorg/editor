import { type AnyNodeId, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import useEditor from '../../../store/use-editor'

export const CeilingSystem = () => {
  const tool = useEditor((state) => state.tool)
  const selectedItem = useEditor((state) => state.selectedItem)
  const movingNode = useEditor((state) => state.movingNode)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const activeLevelId = useViewer((state) => state.selection.levelId)

  useEffect(() => {
    const nodes = useScene.getState().nodes

    const levelsToShowCeilings = new Set<string>()

    const isCeilingToolActive =
      tool === 'ceiling' ||
      selectedItem?.attachTo === 'ceiling' ||
      (movingNode?.type === 'item' && movingNode?.asset?.attachTo === 'ceiling')

    if (isCeilingToolActive && activeLevelId) {
      levelsToShowCeilings.add(activeLevelId)
    }

    for (const id of selectedIds) {
      // Only treat a directly-selected ceiling as "reveal the grid"; a
      // selected descendant (e.g. a freshly-placed ceiling light) used to
      // count too, which left the opaque grid overlay covering the room
      // even after the user moved on. With the grid still in front, every
      // subsequent click in 3D hit the grid mesh (its `useNodeEvents`
      // handlers re-selected the ceiling) instead of the items below.
      const selectedNode = nodes[id as AnyNodeId]
      if (selectedNode?.type !== 'ceiling') continue

      let currentId: string | null = selectedNode.parentId as string | null
      let levelId: string | null = null
      while (currentId && nodes[currentId as AnyNodeId]) {
        const node = nodes[currentId as AnyNodeId]
        if (node?.type === 'level') {
          levelId = node.id
          break
        }
        currentId = node?.parentId as string | null
      }

      if (levelId) {
        levelsToShowCeilings.add(levelId)
      }
    }

    const ceilings = sceneRegistry.byType.ceiling!
    ceilings.forEach((ceiling) => {
      const mesh = sceneRegistry.nodes.get(ceiling)
      if (mesh) {
        const ceilingGrid = mesh.getObjectByName('ceiling-grid')
        if (ceilingGrid) {
          let belongsToVisibleLevel = false
          let currentId: string | null = ceiling

          while (currentId && nodes[currentId as AnyNodeId]) {
            const node = nodes[currentId as AnyNodeId]
            if (node && levelsToShowCeilings.has(node.id)) {
              belongsToVisibleLevel = true
              break
            }
            currentId = node?.parentId as string | null
          }

          const shouldShowGrid =
            belongsToVisibleLevel || (levelsToShowCeilings.size === 0 && isCeilingToolActive)

          ceilingGrid.visible = shouldShowGrid
          ceilingGrid.scale.setScalar(shouldShowGrid ? 1 : 0.0) // Scale down to zero to prevent event interference when grid is hidden
        }
      }
    })
  }, [tool, selectedItem, movingNode, selectedIds, activeLevelId])
  return null
}
