import { type CeilingNode, resolveLevelId, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface CeilingHoleEditorProps {
  ceilingId: CeilingNode['id']
  holeIndex: number
}

/**
 * Ceiling hole editor - allows editing a specific hole polygon within a ceiling
 * Uses the generic PolygonEditor component
 */
export const CeilingHoleEditor: React.FC<CeilingHoleEditorProps> = ({ ceilingId, holeIndex }) => {
  const ceilingNode = useScene((state) => state.nodes[ceilingId])
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null
  const holes = ceiling?.holes || []
  const hole = holes[holeIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      const updatedHoles = [...holes]
      updatedHoles[holeIndex] = newPolygon
      updateNode(ceilingId, { holes: updatedHoles })
      // Re-assert selection so the ceiling stays selected after the edit
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, holeIndex, holes, updateNode, setSelection],
  )

  if (!(ceiling && hole) || hole.length < 3) return null

  return (
    <PolygonEditor
      color="#ef4444"
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)} // red for holes
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={hole}
      surfaceHeight={ceiling.height ?? 2.5}
    />
  )
}
