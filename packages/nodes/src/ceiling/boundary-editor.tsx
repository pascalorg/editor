'use client'

import {
  type CeilingNode,
  resolveLevelId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { PolygonEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect } from 'react'

/**
 * Phase 5 Stage D — ceiling boundary editor (registry-driven).
 *
 * Thin wrapper around the shared `<PolygonEditor>` (same shape as
 * slab's boundary-editor). Activates when a ceiling is selected in
 * structure/select mode and no hole edit is in progress.
 *
 * Drag flow mirrors slab: `onPolygonPreview` pushes the in-flight
 * polygon to `useLiveNodeOverrides` so the ceiling mesh rebuilds at
 * pointer rate; `onPolygonChange` is the single commit on release.
 */
export const CeilingBoundaryEditor: React.FC<{ ceilingId: CeilingNode['id'] }> = ({
  ceilingId,
}) => {
  const ceilingNode = useScene((s) => s.nodes[ceilingId])
  const updateNode = useScene((s) => s.updateNode)
  const markDirty = useScene((s) => s.markDirty)
  const setSelection = useViewer((s) => s.setSelection)

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      updateNode(ceilingId, { polygon: newPolygon })
      setSelection({ selectedIds: [ceilingId] })
    },
    [ceilingId, updateNode, setSelection],
  )

  const handlePolygonPreview = useCallback(
    (preview: ReadonlyArray<readonly [number, number]> | null) => {
      if (preview) {
        useLiveNodeOverrides.getState().set(ceilingId, {
          polygon: preview.map(([x, z]) => [x, z] as [number, number]),
        })
      } else {
        useLiveNodeOverrides.getState().clear(ceilingId)
      }
      markDirty(ceilingId)
    },
    [ceilingId, markDirty],
  )

  useEffect(() => {
    return () => {
      useLiveNodeOverrides.getState().clear(ceilingId)
      useScene.getState().markDirty(ceilingId)
    }
  }, [ceilingId])

  if (!ceiling?.polygon || ceiling.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#d4d4d4"
      levelId={resolveLevelId(ceiling, useScene.getState().nodes)}
      minVertices={3}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      polygon={ceiling.polygon}
      surfaceHeight={ceiling.height ?? 2.5}
    />
  )
}

export default CeilingBoundaryEditor
