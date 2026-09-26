'use client'

import {
  type AnyNodeId,
  type BuildingNode,
  pauseSceneHistory,
  resumeSceneHistory,
  useScene,
} from '@pascal-app/core'
import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef } from 'react'
import { FloorplanGeometryRenderer } from '../../../components/editor-2d/renderers/floorplan-geometry-renderer'
import { clientToPlan } from '../plan-coords'
import { buildSitePlanDrawing } from './build-site-plan-drawing'

/**
 * Site-plan view of the 2D editor.
 *
 * Mounted INSTEAD of `<FloorplanRegistryLayer>` when
 * `useDrawingView().drawingType === 'site-plan'`, inside the same scene `<g>`,
 * so the coordinates it draws in (site metres, origin = the geocoded point,
 * x east, y south) are the ones `clientToPlan` reports back.
 *
 * Everything is recomputed from the scene snapshot on each store change, so
 * the lot line, envelope, footprint and yard dimensions are live.
 */
export function FloorplanSitePlanLayer() {
  // Subscribing to the whole node map is what the site plan actually depends
  // on (walls, building placement, site fields); the drawing is cheap enough
  // (tens of primitives) that memoising on the map identity is sufficient.
  const nodes = useScene((s) => s.nodes)

  const drawing = useMemo(() => {
    const state = useScene.getState()
    return buildSitePlanDrawing({
      nodes,
      rootNodeIds: state.rootNodeIds,
      collections: state.collections,
      materials: state.materials,
      installedPlugins: state.installedPlugins,
    })
  }, [nodes])

  const dragRef = useRef<{
    id: AnyNodeId
    pointerId: number
    startPlan: [number, number]
    startPosition: [number, number, number]
  } | null>(null)

  const buildingId = drawing.meta.buildingId

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<SVGGElement>) => {
      if (!buildingId || event.button !== 0) return
      const building = useScene.getState().nodes[buildingId] as BuildingNode | undefined
      if (!building) return
      const startPlan = clientToPlan(event.clientX, event.clientY)
      if (!startPlan) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      dragRef.current = {
        id: buildingId,
        pointerId: event.pointerId,
        startPlan: [startPlan[0], startPlan[1]],
        startPosition: [...building.position] as [number, number, number],
      }
      // One history entry for the whole drag, committed on pointer-up.
      pauseSceneHistory(useScene)
    },
    [buildingId],
  )

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const plan = clientToPlan(event.clientX, event.clientY)
    if (!plan) return
    const dx = plan[0] - drag.startPlan[0]
    const dz = plan[1] - drag.startPlan[1]
    useScene.getState().updateNode(drag.id, {
      position: [drag.startPosition[0] + dx, drag.startPosition[1], drag.startPosition[2] + dz],
    })
  }, [])

  const endDrag = useCallback((event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    resumeSceneHistory(useScene)
  }, [])

  const footprintIndexes = new Set<number>()
  drawing.primitives.forEach((p, i) => {
    const meta = (p as { metadata?: Record<string, unknown> }).metadata
    if (meta?.sitePlan === 'building-footprint') footprintIndexes.add(i)
  })

  return (
    <g data-site-plan="">
      {drawing.primitives.map((geometry, index) =>
        footprintIndexes.has(index) ? null : (
          <FloorplanGeometryRenderer
            geometry={geometry}
            // eslint-disable-next-line react/no-array-index-key -- primitives are positional, rebuilt wholesale each render
            key={`site-plan-${index}`}
          />
        ),
      )}
      {/* Footprint bands live in their own group so the whole building drags
          as one target, writing `building.position` — the same field the 3D
          move tool writes. */}
      <g
        data-site-plan-building=""
        onPointerCancel={endDrag}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        style={{ cursor: buildingId ? 'move' : undefined }}
      >
        {drawing.primitives.map((geometry, index) =>
          footprintIndexes.has(index) ? (
            <FloorplanGeometryRenderer
              geometry={geometry}
              // eslint-disable-next-line react/no-array-index-key -- see above
              key={`site-plan-fp-${index}`}
            />
          ) : null,
        )}
      </g>
    </g>
  )
}

export default FloorplanSitePlanLayer
