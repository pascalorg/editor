'use client'

import { resolveLevelId, type SlabNode, useScene } from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useCallback } from 'react'

/**
 * Phase 5 Stage D — slab hole editor (registry-driven).
 *
 * Edits a specific hole polygon inside a slab. Mounted by ToolManager
 * via `def.affordanceTools['hole-edit']` when `useEditor.editingHole`
 * is set on the selected slab.
 */
export const SlabHoleEditor: React.FC<{ slabId: SlabNode['id']; holeIndex: number }> = ({
  slabId,
  holeIndex,
}) => {
  const slabNode = useScene((s) => s.nodes[slabId])
  const updateNode = useScene((s) => s.updateNode)
  const setSelection = useViewer((s) => s.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null
  const holes = slab?.holes || []
  const hole = holes[holeIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      const updatedHoles = [...holes]
      updatedHoles[holeIndex] = newPolygon
      updateNode(slabId, { holes: updatedHoles })
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, holeIndex, holes, updateNode, setSelection],
  )

  if (!(slab && hole) || hole.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      allowPolygonMove
      color="#ef4444"
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={hole}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}

export default SlabHoleEditor
