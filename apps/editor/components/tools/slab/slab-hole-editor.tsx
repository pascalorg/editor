import { resolveLevelId, type SlabNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface SlabHoleEditorProps {
  slabId: SlabNode['id']
  holeIndex: number
}

/**
 * Slab hole editor - allows editing a specific hole polygon within a slab
 * Uses the generic PolygonEditor component
 */
export const SlabHoleEditor: React.FC<SlabHoleEditorProps> = ({ slabId, holeIndex }) => {
  const slabNode = useScene((state) => state.nodes[slabId])
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null
  const holes = slab?.holes || []
  const hole = holes[holeIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      const updatedHoles = [...holes]
      updatedHoles[holeIndex] = newPolygon
      updateNode(slabId, { holes: updatedHoles })
      // Re-assert selection so the slab stays selected after the edit
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, holeIndex, holes, updateNode, setSelection],
  )

  if (!slab || !hole || hole.length < 3) return null

  return (
    <PolygonEditor
      polygon={hole}
      color="#ef4444" // red for holes
      onPolygonChange={handlePolygonChange}
      minVertices={3}
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}
