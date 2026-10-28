'use client'

import {
  type AnyNode,
  type FoundationNode,
  resolveLevelId,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  boundaryReshapeScope,
  clearSlabSnapFeedback,
  getSegmentGridStep,
  PolygonEditor,
  type PolygonEditorPlanPointSnapContext,
  snapScalarToGrid,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect } from 'react'
import { squareToNeighbours } from './floorplan-affordances'
import { snapEdgeToWallFaces, snapPointToWallFaces, wallFacesOf } from './wall-face-snap'

/** The editor's handles stand just over the slab's top, where the foundation view shows them. */
const HANDLE_HEIGHT = 0.12

/**
 * Where a 3D drag of a foundation outline lands, as the plan's drags do: a side, square to itself
 * on the grid, onto a wall's outside face (`faces`) it runs with when near; a corner onto the faces
 * or squared to its neighbours, else the grid. `faces` `null` (Alt): the grid alone. A whole-outline
 * move keeps to the grid: its cursor is no corner to snap.
 */
export function foundationEditorPlanPoint(
  context: PolygonEditorPlanPointSnapContext,
  faces: [number, number][][] | null,
): [number, number] {
  if (context.mode === 'edge' && context.edgeIndex !== undefined) {
    const a = context.initialPolygon[context.edgeIndex]
    const b = context.initialPolygon[(context.edgeIndex + 1) % context.initialPolygon.length]
    if (a && b) {
      const dx = b[0] - a[0]
      const dz = b[1] - a[1]
      const length = Math.hypot(dx, dz)
      if (length > 1e-6) {
        const normalX = -dz / length
        const normalZ = dx / length
        const rawDelta =
          (context.rawPoint[0] - context.initialPosition[0]) * normalX +
          (context.rawPoint[1] - context.initialPosition[1]) * normalZ
        const projection = snapScalarToGrid(rawDelta, getSegmentGridStep())
        const snap = faces
          ? snapEdgeToWallFaces(faces, [
              [a[0] + normalX * projection, a[1] + normalZ * projection],
              [b[0] + normalX * projection, b[1] + normalZ * projection],
            ])
          : null
        const distance = snap
          ? (snap[0][0] - a[0]) * normalX + (snap[0][1] - a[1]) * normalZ
          : projection
        return [
          context.initialPosition[0] + normalX * distance,
          context.initialPosition[1] + normalZ * distance,
        ]
      }
    }
  }
  if (!faces || context.mode !== 'vertex' || context.vertexIndex === null) return context.gridPoint
  return (
    snapPointToWallFaces(faces, context.rawPoint) ??
    squareToNeighbours(
      context.rawPoint,
      context.gridPoint,
      context.initialPolygon,
      context.vertexIndex,
    )
  )
}

/**
 * The foundation outline's 3D editor: the slab's own `PolygonEditor` (drag a corner, slide a side
 * square to itself), snapping as the plan does: onto the walls' outside faces, where the traced
 * foundation runs, a corner squaring to its neighbours, else the grid; Alt drags free. The drag previews
 * through the live overrides, which the foundation's concrete follows at pointer rate, and lands as
 * one undo step on release. Mounted by the tool manager for a sole selected outline.
 */
export const FoundationBoundaryEditor: React.FC<{ foundationId: FoundationNode['id'] }> = ({
  foundationId,
}) => {
  const stored = useScene((state) => state.nodes[foundationId])
  const node = stored?.type === 'foundation' ? stored : null
  const levelId = node ? resolveLevelId(node, useScene.getState().nodes) : null

  const handlePolygonChange = useCallback(
    (polygon: Array<[number, number]>) => {
      clearSlabSnapFeedback()
      useScene.getState().updateNode(foundationId, { polygon })
    },
    [foundationId],
  )

  const handlePolygonPreview = useCallback(
    (preview: ReadonlyArray<readonly [number, number]> | null) => {
      if (preview)
        useLiveNodeOverrides.getState().set(foundationId, {
          polygon: preview.map(([x, z]) => [x, z] as [number, number]),
        })
      else {
        clearSlabSnapFeedback()
        useLiveNodeOverrides.getState().clear(foundationId)
      }
    },
    [foundationId],
  )

  const handleDragStateChange = useCallback(
    (isDragging: boolean) => {
      const scope = useInteractionScope.getState()
      if (isDragging) scope.begin(boundaryReshapeScope(foundationId))
      else scope.endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
    },
    [foundationId],
  )

  const resolvePlanPoint = useCallback(
    (context: PolygonEditorPlanPointSnapContext) =>
      foundationEditorPlanPoint(
        context,
        context.nativeEvent?.altKey === true
          ? null
          : wallFacesOf(useScene.getState().nodes as Record<string, AnyNode>, levelId),
      ),
    [levelId],
  )

  useEffect(
    () => () => {
      clearSlabSnapFeedback()
      useLiveNodeOverrides.getState().clear(foundationId)
      useInteractionScope
        .getState()
        .endIf((s) => s.kind === 'reshaping' && s.reshape === 'boundary')
    },
    [foundationId],
  )

  if (!node || node.polygon.length < 3) return null

  return (
    <PolygonEditor
      allowEdgeMove
      color="#94a3b8"
      levelId={levelId ?? undefined}
      minVertices={3}
      onDragCommit={clearSlabSnapFeedback}
      onDragStateChange={handleDragStateChange}
      onPolygonChange={handlePolygonChange}
      onPolygonPreview={handlePolygonPreview}
      polygon={node.polygon}
      resolvePlanPoint={resolvePlanPoint}
      surfaceHeight={HANDLE_HEIGHT}
    />
  )
}

export default FoundationBoundaryEditor
