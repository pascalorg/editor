'use client'

import { type CeilingNode, resolveLevelId, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  boundaryReshapeScope,
  clearCeilingSnapFeedback,
  PolygonEditor,
  type PolygonEditorPlanPointSnapContext,
  resolveCeilingPlanPointSnap,
  triggerSFX,
  useInteractionScope,
} from '@pascal-app/editor'
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
  const ceilingLevelId = effectiveCeiling
    ? resolveLevelId(effectiveCeiling, useScene.getState().nodes)
    : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      clearCeilingSnapFeedback()
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
      // A vertex/edge drag is a `boundary` reshape — drive the snapping HUD
      // (no-angle 'polygon' set) and keep the idle select hints off-screen.
      const scope = useInteractionScope.getState()
      if (isDragging) {
        scope.begin(boundaryReshapeScope(ceilingId))
      } else {
        scope.endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
        ownsPolygonPreviewRef.current = false
        clearCeilingSnapFeedback()
      }
      setCeilingHandleHover(isDragging)
    },
    [ceilingId, setCeilingHandleHover],
  )

  const handlePolygonEditorDragCommit = useCallback(() => {
    triggerSFX('sfx:item-place')
    clearCeilingSnapFeedback()
  }, [])

  const handlePolygonEditorDragStart = useCallback(() => {
    ownsPolygonPreviewRef.current = true
    triggerSFX('sfx:item-pick')
  }, [])

  const handlePolygonEditorBeforeVertexDrag = useCallback(() => {
    ownsPolygonPreviewRef.current = true
  }, [])

  const resolvePolygonEditorPlanPoint = useCallback(
    (context: PolygonEditorPlanPointSnapContext) =>
      resolveCeilingPlanPointSnap({
        rawPoint: context.rawPoint,
        fallbackPoint: context.gridPoint,
        levelId: ceilingLevelId,
        excludeId: ceilingId,
        altKey: context.nativeEvent?.altKey === true,
      }).point,
    [ceilingId, ceilingLevelId],
  )

  useEffect(() => {
    return () => {
      clearCeilingSnapFeedback()
      useLiveNodeOverrides.getState().clear(ceilingId)
      useScene.getState().markDirty(ceilingId)
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
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
      levelId={ceilingLevelId ?? undefined}
      minVertices={3}
      onBeforeVertexDrag={handlePolygonEditorBeforeVertexDrag}
      onDragCommit={handlePolygonEditorDragCommit}
      onDragStart={handlePolygonEditorDragStart}
      onDragStateChange={handleDragStateChange}
      onEdgeHoverChange={handleHandleHoverChange}
      onMidpointHoverChange={handleHandleHoverChange}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      onVertexHoverChange={handleHandleHoverChange}
      polygon={effectiveCeiling.polygon}
      resolvePlanPoint={resolvePolygonEditorPlanPoint}
      surfaceHeight={effectiveCeiling.height ?? 2.5}
    />
  )
}

export default CeilingBoundaryEditor
