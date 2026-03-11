import { resolveLevelId, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface SlabBoundaryEditorProps {
  slabId: SlabNode['id']
}

/**
 * Slab boundary editor - allows editing slab polygon vertices for a specific slab
 * Uses the generic PolygonEditor component
 */
export const SlabBoundaryEditor: React.FC<SlabBoundaryEditorProps> = ({ slabId }) => {
  const slabNode = useScene((state) => state.nodes[slabId])
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(slabId, { polygon: newPolygon })
      // Re-assert selection so the slab stays selected after the edit
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, updateNode, setSelection],
  )

  if (!slab || !slab.polygon || slab.polygon.length < 3) return null

  return (
    <PolygonEditor
      polygon={slab.polygon}
      color="#a3a3a3"
      onPolygonChange={handlePolygonChange}
      minVertices={3}
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}
