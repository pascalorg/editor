'use client'

import { type CeilingNode, resolveLevelId, useScene } from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useCallback } from 'react'

/**
 * Phase 5 Stage D — ceiling boundary editor (registry-driven).
 *
 * Thin wrapper around the shared `<PolygonEditor>` (same shape as
 * slab's boundary-editor). Activates when a ceiling is selected in
 * structure/select mode and no hole edit is in progress.
 */
export const CeilingBoundaryEditor: React.FC<{ ceilingId: CeilingNode['id'] }> = ({
  ceilingId,
}) => {
  const ceilingNode = useScene((s) => s.nodes[ceilingId])
  const updateNode = useScene((s) => s.updateNode)
  const setSelection = useViewer((s) => s.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(ceilingId, { polygon: newPolygon })
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, updateNode, setSelection],
  )

  if (!ceiling?.polygon || ceiling.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#d4d4d4"
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={ceiling.polygon}
      surfaceHeight={ceiling.height ?? 2.5}
    />
  )
}

export default CeilingBoundaryEditor
