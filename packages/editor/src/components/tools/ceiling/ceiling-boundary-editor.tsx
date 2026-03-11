import { resolveLevelId, type CeilingNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'
import { PolygonEditor } from '../shared/polygon-editor'

interface CeilingBoundaryEditorProps {
  ceilingId: CeilingNode['id']
}

/**
 * Ceiling boundary editor - allows editing ceiling polygon vertices for a specific ceiling
 * Uses the generic PolygonEditor component
 */
export const CeilingBoundaryEditor: React.FC<CeilingBoundaryEditorProps> = ({ ceilingId }) => {
  const ceilingNode = useScene((state) => state.nodes[ceilingId])
  const updateNode = useScene((state) => state.updateNode)
  const setSelection = useViewer((state) => state.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(ceilingId, { polygon: newPolygon })
      // Re-assert selection so the ceiling stays selected after the edit
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, updateNode, setSelection],
  )

  if (!ceiling || !ceiling.polygon || ceiling.polygon.length < 3) return null

  return (
    <PolygonEditor
      polygon={ceiling.polygon}
      color="#d4d4d4"
      onPolygonChange={handlePolygonChange}
      minVertices={3}
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)}
      surfaceHeight={ceiling.height ?? 2.5}
    />
  )
}
