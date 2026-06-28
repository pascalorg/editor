'use client'

import { resolveLevelId, type SlabNode, useLiveNodeOverrides, useScene } from '@pascal-app/core'
import {
  boundaryReshapeScope,
  clearSlabSnapFeedback,
  PolygonEditor,
  type PolygonEditorPlanPointSnapContext,
  resolveSlabPlanPointSnap,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect } from 'react'

/**
 * Phase 5 Stage D — slab boundary editor (registry-driven).
 *
 * Thin wrapper around the shared `PolygonEditor`. Activates when a
 * slab is selected in structure/select mode (not currently editing a
 * hole). The heavy lifting — vertex drag, edge slide, snap, history
 * bracketing — lives in `PolygonEditor` itself.
 *
 * Mounted by ToolManager via `def.affordanceTools['boundary-edit']`.
 *
 * Drag flow: every pointer tick the editor hands back the in-flight
 * polygon through `onPolygonPreview`; we mirror it onto
 * `useLiveNodeOverrides` + `markDirty` so `GeometrySystem` rebuilds
 * the slab mesh at pointer rate. On release the editor calls
 * `onPolygonChange` once with the final polygon — that's the single
 * `updateNode` tracked by undo. The follow-up `onPolygonPreview(null)`
 * drops the override so subscribers read from the store again.
 */
export const SlabBoundaryEditor: React.FC<{ slabId: SlabNode['id'] }> = ({ slabId }) => {
  const slabNode = useScene((s) => s.nodes[slabId])
  const updateNode = useScene((s) => s.updateNode)
  const markDirty = useScene((s) => s.markDirty)
  const setSelection = useViewer((s) => s.setSelection)

  const slab = slabNode?.type === 'slab' ? (slabNode as SlabNode) : null
  const slabLevelId = slab ? resolveLevelId(slab, useScene.getState().nodes) : null

  const handlePolygonChange = useCallback(
    (newPolygon: Array<[number, number]>) => {
      clearSlabSnapFeedback()
      updateNode(slabId, { polygon: newPolygon })
      setSelection({ selectedIds: [slabId] })
    },
    [slabId, updateNode, setSelection],
  )

  const handlePolygonPreview = useCallback(
    (preview: ReadonlyArray<readonly [number, number]> | null) => {
      if (preview) {
        useLiveNodeOverrides.getState().set(slabId, {
          polygon: preview.map(([x, z]) => [x, z] as [number, number]),
        })
      } else {
        clearSlabSnapFeedback()
        useLiveNodeOverrides.getState().clear(slabId)
      }
      markDirty(slabId)
    },
    [slabId, markDirty],
  )

  const handleDragCommit = useCallback(() => {
    clearSlabSnapFeedback()
  }, [])

  // A vertex/edge drag is a `boundary` reshape — drive the snapping HUD (the
  // no-angle 'polygon' set) and keep the idle select hints off-screen.
  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      const scope = useInteractionScope.getState()
      if (isDragging) scope.begin(boundaryReshapeScope(slabId))
      else scope.endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
    },
    [slabId],
  )

  const resolvePolygonEditorPlanPoint = useCallback(
    (context: PolygonEditorPlanPointSnapContext) =>
      resolveSlabPlanPointSnap({
        rawPoint: context.rawPoint,
        fallbackPoint: context.gridPoint,
        levelId: slabLevelId,
        excludeId: slabId,
        altKey: context.nativeEvent?.altKey === true,
      }).point,
    [slabId, slabLevelId],
  )

  // Guarantee the override clears if the editor unmounts mid-drag
  // (selection change, mode switch) so the slab mesh doesn't get stuck
  // on a stale polygon.
  useEffect(() => {
    return () => {
      clearSlabSnapFeedback()
      useLiveNodeOverrides.getState().clear(slabId)
      useScene.getState().markDirty(slabId)
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
    }
  }, [slabId])

  if (!slab?.polygon || slab.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#a3a3a3"
      levelId={slabLevelId ?? undefined}
      minVertices={3}
      onDragCommit={handleDragCommit}
      onDragStateChange={handleDragStateChange}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      polygon={slab.polygon}
      resolvePlanPoint={resolvePolygonEditorPlanPoint}
      surfaceHeight={slab.elevation ?? 0.05}
    />
  )
}

export default SlabBoundaryEditor
