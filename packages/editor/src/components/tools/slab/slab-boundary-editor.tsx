import { resolveLevelId, type SlabNode, useScene } from '@vesper/core'
import { useViewer } from '@vesper/viewer'
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

  if (!(slab && slab.polygon) || slab.polygon.length < 3) return null

  return (
    <PolygonEditor
      color="#a3a3a3"
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={slab.polygon}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}
