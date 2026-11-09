'use client'

import {
  type AnyNodeId,
  type BeamNode,
  beamPlan,
  beamTopElevation,
  emitter,
  type GridEvent,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  DRAFT_LABEL_Y_OFFSET,
  DraftMeasurementLabel,
  formatLinearMeasurement,
  isSegmentLongEnough,
  markToolCancelConsumed,
  type PlacementPreviewDimension,
  triggerSFX,
  useEditor,
  usePlacementPreview,
  useWallSnapIndicator,
  visibleScene,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { getSceneTheme, useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useMemo, useState } from 'react'
import { DoubleSide } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  type FloorPlacementClickTriggerEvent,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { draftBeam, snapBeamPoint } from './drafting'
import { beamBox, buildBeamGeometry } from './geometry'

const ghostMaterial = new MeshBasicNodeMaterial({
  color: '#f59e0b',
  depthWrite: false,
  opacity: 0.5,
  side: DoubleSide,
  transparent: true,
})

/** The draft's length, as a dimension along it in the plan (the 3D view prints its own label). */
export function beamDraftDimensions(beam: BeamNode): PlacementPreviewDimension[] {
  const plan = beamPlan(beam)
  if (plan.length < 0.05) return []
  return [
    {
      id: 'beam-length',
      start: [plan.start[0], 0, plan.start[1]],
      end: [plan.end[0], 0, plan.end[1]],
      offsetNormal: plan.normal,
      offsetDistance: plan.width / 2 + 0.25,
      value: plan.length,
      renderIn3d: false,
    },
  ]
}

/**
 * Drafting beams from the grid events both views send: a click sets the start, the next ends the
 * beam and starts the next one there, so a porch's run is drawn corner to corner; Esc ends the run.
 * Points snap as walls do (wall ends, faces and crossings, other beams' ends and runs, post
 * centres, the grid, the angle steps off the start); Alt places freely. The beam takes the Build
 * panel's size, material and top (`useBeamDraft`), or the preset a host armed the tool with.
 * `enabled` off, it stands aside.
 */
function useBeamDrafting(enabled: boolean) {
  const levelId = useViewer((state) => state.selection.levelId)
  const [draft, setDraft] = useState<BeamNode | null>(null)
  const [cursor, setCursor] = useState<[number, number, number] | null>(null)

  useEffect(() => {
    if (!(enabled && levelId)) return
    let start: WallPlanPoint | null = null
    let last: WallPlanPoint | null = null
    setDraft(null)

    const snap = (event: GridEvent | FloorPlacementClickTriggerEvent): WallPlanPoint => {
      const { point, snap: caught } = snapBeamPoint({
        point: [event.localPosition[0], event.localPosition[2]],
        nodes: useScene.getState().nodes,
        levelId,
        start,
        free: event.nativeEvent?.altKey === true,
      })
      if (caught) useWallSnapIndicator.getState().set({ x: point[0], z: point[1], kind: caught })
      else useWallSnapIndicator.getState().clear()
      return point
    }
    const make = (from: WallPlanPoint, to: WallPlanPoint, fields?: Partial<BeamNode>) =>
      draftBeam(
        from,
        to,
        levelId,
        useScene.getState().nodes,
        undefined,
        useEditor.getState().toolDefaults.beam,
        fields,
      )
    const show = (next: BeamNode | null) => {
      setDraft(next)
      if (next) usePlacementPreview.getState().set(next, null, beamDraftDimensions(next))
      else usePlacementPreview.getState().clear()
    }

    const onMove = (event: GridEvent) => {
      const point = snap(event)
      if (last && point[0] === last[0] && point[1] === last[1]) return
      last = point
      setCursor([point[0], event.localPosition[1], point[1]])
      show(start && isSegmentLongEnough(start, point) ? make(start, point) : null)
    }
    const onClick = (event: FloorPlacementClickTriggerEvent) => {
      const point = last ?? snap(event)
      stopPlacementCommitPropagation(event)
      if (!start) {
        start = point
        triggerSFX('sfx:grid-snap')
        return
      }
      if (!isSegmentLongEnough(start, point)) return
      const count = Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'beam',
      ).length
      const beam = make(start, point, { name: `Beam ${count + 1}` })
      useScene.getState().createNode(beam, levelId as AnyNodeId)
      triggerSFX('sfx:structure-build')
      // The run goes on from the end just placed.
      start = point
      show(null)
    }
    const onCancel = () => {
      if (!start) return
      markToolCancelConsumed()
      start = null
      show(null)
    }

    emitter.on('grid:move', onMove)
    emitter.on('tool:cancel', onCancel)
    const unsubscribeClicks = subscribeFloorPlacementClicks(onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('tool:cancel', onCancel)
      unsubscribeClicks()
      usePlacementPreview.getState().clear()
      useWallSnapIndicator.getState().clear()
      setDraft(null)
      setCursor(null)
    }
  }, [enabled, levelId])

  return { levelId, draft, cursor }
}

/**
 * The beam tool in 2D-only view: the 3D tool lives in the canvas, which never renders while its
 * pane is hidden. The plan draws the draft from the placement preview. Split and 3D views keep the
 * 3D tool as the one owner.
 */
export function BeamFloorplanTool() {
  useBeamDrafting(useEditor((state) => visibleScene(state) === '2d'))
  return null
}

const BeamTool = () => {
  const { levelId, draft, cursor } = useBeamDrafting(
    useEditor((state) => visibleScene(state) !== '2d'),
  )
  const top = useScene((state) => (draft ? beamTopElevation(state.nodes, draft) : 0))
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const dark = useViewer((state) => getSceneTheme(state.sceneTheme).appearance === 'dark')
  const placed = draft ? beamBox(draft, top) : null
  const length = placed?.size[0] ?? 0
  const geometry = useMemo(
    () => (draft && length > 0 ? buildBeamGeometry(draft, length) : null),
    [draft, length],
  )
  useEffect(() => () => geometry?.dispose(), [geometry])
  const level = levelId ? sceneRegistry.nodes.get(levelId) : undefined

  if (!levelId) return null
  return (
    <>
      {cursor && <CursorSphere position={cursor} />}
      {placed &&
        geometry &&
        level &&
        createPortal(
          <group>
            <mesh
              geometry={geometry}
              material={ghostMaterial}
              position={placed.position}
              raycast={() => {}}
              renderOrder={2}
              rotation-y={placed.rotationY}
            />
            <DraftMeasurementLabel
              color={dark ? '#ffffff' : '#111111'}
              label={formatLinearMeasurement(length, unit, metricNotation)}
              position={[placed.position[0], top + DRAFT_LABEL_Y_OFFSET, placed.position[2]]}
              shadowColor={dark ? '#111111' : '#ffffff'}
            />
          </group>,
          level,
        )}
    </>
  )
}

export default BeamTool
