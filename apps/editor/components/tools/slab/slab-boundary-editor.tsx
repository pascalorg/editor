import { sceneRegistry, useScene, type AnyNodeId, type SlabNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

/**
 * Slab boundary editor - allows editing slab polygon vertices when a slab is selected
 * Uses the generic PolygonEditor component
 */
export const SlabBoundaryEditor: React.FC = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const levelId = useViewer((state) => state.selection.levelId)
  const setSelection = useViewer((state) => state.setSelection)
  const nodes = useScene((state) => state.nodes)
  const updateNode = useScene((state) => state.updateNode)

  // Find the first selected slab
  const selectedSlabId =
    selectedIds.find((id) => nodes[id as AnyNodeId]?.type === 'slab') ?? null
  const slab = selectedSlabId ? (nodes[selectedSlabId as AnyNodeId] as SlabNode) : null

  // Get level Y position for the editing plane
  let levelY = 0
  if (levelId) {
    const levelMesh = sceneRegistry.nodes.get(levelId)
    if (levelMesh) {
      levelY = levelMesh.position.y
    } else {
      const levelNode = nodes[levelId]
      if (levelNode && 'level' in levelNode) {
        const levelMode = useViewer.getState().levelMode
        const LEVEL_HEIGHT = 2.5
        const EXPLODED_GAP = 5
        levelY =
          ((levelNode as any).level || 0) *
          (LEVEL_HEIGHT + (levelMode === 'exploded' ? EXPLODED_GAP : 0))
      }
    }
  }

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      if (selectedSlabId) {
        updateNode(selectedSlabId as SlabNode['id'], { polygon: newPolygon })
        // Re-assert selection so the slab stays selected after the edit
        setSelection({ selectedIds: [selectedSlabId] })
      }
    },
    [selectedSlabId, updateNode, setSelection],
  )

  if (!slab || !slab.polygon || slab.polygon.length < 3) return null

  return (
    <PolygonEditor
      polygon={slab.polygon}
      color="#a3a3a3"
      onPolygonChange={handlePolygonChange}
      minVertices={3}
      levelY={levelY}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}
