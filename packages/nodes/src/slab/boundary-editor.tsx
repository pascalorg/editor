'use client'

import { resolveLevelId, type SlabNode, useScene } from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback } from 'react'

/**
 * Phase 5 Stage D — slab boundary editor (registry-driven).
 *
 * Thin wrapper around the shared `PolygonEditor`. Activates when a
 * slab is selected in structure/select mode (not currently editing a
 * hole). The heavy lifting — vertex drag, edge slide, snap, history
 * bracketing — lives in `PolygonEditor` itself.
 *
 * Mounted by ToolManager via `def.affordanceTools['boundary-edit']`.
 */
export const SlabBoundaryEditor: React.FC<{ slabId: SlabNode['id'] }> = ({ slabId }) => {
  const slabNode = useScene((s) => s.nodes[slabId])
  const updateNode = useScene((s) => s.updateNode)
  const setSelection = useViewer((s) => s.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(slabId, { polygon: newPolygon })
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, updateNode, setSelection],
  )

  if (!slab?.polygon || slab.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#a3a3a3"
      levelId={resolveLevelId(slab, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      polygon={slab.polygon}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}

export default SlabBoundaryEditor
