'use client'

import { type CeilingNode, resolveLevelId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import { PolygonEditor, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useMemo, useRef } from 'react'

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
  const setHoveredId = useViewer((s) => s.setHoveredId)
  const ownsCeilingHoverRef = useRef(false)
  const ownsPolygonPreviewRef = useRef(false)
  const liveOverride = useLiveNodeOverrides((state) => {
    if (ownsPolygonPreviewRef.current) return null
    return state.overrides.get(ceilingId) as Partial<CeilingNode> | undefined
  })

  const ceiling = ceilingNode?.type === 'ceiling' ? (ceilingNode as CeilingNode) : null
  const effectiveCeiling = useMemo(
    () => (ceiling && liveOverride ? ({ ...ceiling, ...liveOverride } as CeilingNode) : ceiling),
    [ceiling, liveOverride],
  )

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
        ownsPolygonPreviewRef.current = true
        useLiveNodeOverrides.getState().set(ceilingId, {
          polygon: preview.map(([x, z]) => [x, z] as [number, number]),
        })
      } else {
        useLiveNodeOverrides.getState().clear(ceilingId)
        ownsPolygonPreviewRef.current = false
      }
      markDirty(ceilingId)
    },
    [ceilingId, markDirty],
  )

  const setCeilingHandleHover = useCallback(
    (active: boolean) => {
      if (active) {
        ownsCeilingHoverRef.current = true
        setHoveredId(ceilingId)
        return
      }
      if (ownsCeilingHoverRef.current && useViewer.getState().hoveredId === ceilingId) {
        setHoveredId(null)
      }
      ownsCeilingHoverRef.current = false
    },
    [ceilingId, setHoveredId],
  )

  const handleHandleHoverChange = useCallback(
    (index: number | null) => {
      setCeilingHandleHover(index !== null)
    },
    [setCeilingHandleHover],
  )

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      if (!isDragging) {
        ownsPolygonPreviewRef.current = false
      }
      setCeilingHandleHover(isDragging)
    },
    [setCeilingHandleHover],
  )

  const handlePolygonEditorDragStart = useCallback(() => {
    ownsPolygonPreviewRef.current = true
    triggerSFX('sfx:item-pick')
  }, [])

  const handlePolygonEditorBeforeVertexDrag = useCallback(() => {
    ownsPolygonPreviewRef.current = true
  }, [])

  useEffect(() => {
    return () => {
      useLiveNodeOverrides.getState().clear(ceilingId)
      useScene.getState().markDirty(ceilingId)
      ownsPolygonPreviewRef.current = false
      if (ownsCeilingHoverRef.current && useViewer.getState().hoveredId === ceilingId) {
        useViewer.getState().setHoveredId(null)
      }
      ownsCeilingHoverRef.current = false
    }
  }, [ceilingId])

  if (!effectiveCeiling?.polygon || effectiveCeiling.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#d4d4d4"
      highlightConnectedHandles
      levelId={resolveLevelId(effectiveCeiling, useScene.getState().nodes)}
      minVertices={3}
      onBeforeVertexDrag={handlePolygonEditorBeforeVertexDrag}
      onDragStateChange={handleDragStateChange}
      onDragCommit={() => triggerSFX('sfx:item-place')}
      onDragStart={handlePolygonEditorDragStart}
      onEdgeHoverChange={handleHandleHoverChange}
      onMidpointHoverChange={handleHandleHoverChange}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      onVertexHoverChange={handleHandleHoverChange}
      polygon={effectiveCeiling.polygon}
      surfaceHeight={effectiveCeiling.height ?? 2.5}
    />
  )
}

export default CeilingBoundaryEditor
