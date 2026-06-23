'use client'

import { type CeilingNode, resolveLevelId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect } from 'react'

/**
 * Phase 5 Stage D — ceiling hole editor (registry-driven).
 */
export const CeilingHoleEditor: React.FC<{
  ceilingId: CeilingNode['id']
  holeIndex: number
}> = ({ ceilingId, holeIndex }) => {
  const ceilingNode = useScene((s) => s.nodes[ceilingId])
  const updateNode = useScene((s) => s.updateNode)
  const markDirty = useScene((s) => s.markDirty)
  const setSelection = useViewer((s) => s.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null
  const holes = ceiling?.holes || []
  const hole = holes[holeIndex]

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      const updatedHoles = [...holes]
      updatedHoles[holeIndex] = newPolygon
      updateNode(ceilingId, { holes: updatedHoles })
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, holeIndex, holes, updateNode, setSelection],
  )

  const handlePolygonPreview = useCallback(
    (preview: ReadonlyArray<readonly [number, number]> | null) => {
      if (preview) {
        const updatedHoles = [...holes]
        updatedHoles[holeIndex] = preview.map(([x, z]) => [x, z] as [number, number])
        useLiveNodeOverrides.getState().set(ceilingId, { holes: updatedHoles })
      } else {
        useLiveNodeOverrides.getState().clear(ceilingId)
      }
      markDirty(ceilingId)
    },
    [ceilingId, holeIndex, holes, markDirty],
  )

  useEffect(() => {
    return () => {
      useLiveNodeOverrides.getState().clear(ceilingId)
      useScene.getState().markDirty(ceilingId)
    }
  }, [ceilingId])

  if (!(ceiling && hole) || hole.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      allowPolygonMove
      color="#ef4444"
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      polygon={hole}
      surfaceHeight={ceiling.height ?? 2.5}
    />
  )
}

export default CeilingHoleEditor
