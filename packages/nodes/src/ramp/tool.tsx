'use client'

import { emitter, type GridEvent } from '@pascal-app/core'
import {
  clearSurfacePlanSnapFeedback,
  EDITOR_LAYER,
  useEditor,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
  subscribeFloorPlacementDoubleClicks,
} from '../shared/floor-placement'
import {
  RampDraftControls,
  rampDraftLastPoint,
  useRampDraft,
  useRampDraftController,
} from './draft'
import { rampSiteToPlan } from './edit'
import { buildRampGeometry } from './geometry'
import { snapRampPlanPoint } from './snapping'

export default function RampTool() {
  const context = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const controller = useRampDraftController({ ...context, finishTool, view: '3d' })
  const { frame, addPoint, finish, preview, previewError, draft } = controller
  const siteId = frame?.site.id
  const building = frame?.building ?? null
  const ghost = useMemo(() => {
    if (!preview) return null
    const group = buildRampGeometry(preview, undefined, 'solid', false)
    group.traverse((object) => {
      object.raycast = () => {}
      object.layers.set(EDITOR_LAYER)
      object.castShadow = false
      object.receiveShadow = false
    })
    return group
  }, [preview])
  useEffect(
    () => () => {
      ghost?.traverse((object) => {
        if ('geometry' in object) (object.geometry as { dispose: () => void }).dispose()
      })
    },
    [ghost],
  )
  useEffect(() => {
    if (!siteId) return
    const resolve = (position: [number, number, number], alt = false) =>
      snapRampPlanPoint(
        rampSiteToPlan(building, [position[0], position[2]]),
        rampDraftLastPoint(useRampDraft.getState()),
        building,
        context.activeLevelId,
        useEditor.getState().gridSnapStep,
        alt,
      )
    const isCanvasEvent = (native?: { target: EventTarget | null }) =>
      typeof HTMLCanvasElement !== 'undefined' && native?.target instanceof HTMLCanvasElement
    const move = (event: GridEvent) => {
      if (!isCanvasEvent(event.nativeEvent) || context.isCameraDragging()) return
      useRampDraft.setState({ hover: resolve(event.position, event.nativeEvent?.altKey) })
    }
    emitter.on('grid:move', move)
    const unsubscribeClick = subscribeFloorPlacementClicks((event) => {
      if (!isCanvasEvent(event.nativeEvent) || context.isCameraDragging()) return
      addPoint(resolve(event.position, event.nativeEvent?.altKey))
      stopPlacementCommitPropagation(event)
    })
    const unsubscribeDouble = subscribeFloorPlacementDoubleClicks((event) => {
      if (!isCanvasEvent(event.nativeEvent) || context.isCameraDragging()) return
      stopPlacementCommitPropagation(event)
      finish()
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribeClick()
      unsubscribeDouble()
      clearSurfacePlanSnapFeedback()
    }
  }, [addPoint, context.activeLevelId, context.isCameraDragging, finish, siteId, building])
  return (
    <>
      {createPortal(
        <>
          {ghost && <primitive object={ghost} />}
          {draft.start && (
            <mesh
              layers={EDITOR_LAYER}
              position={[draft.start[0], draft.options.startHeight + 0.02, draft.start[1]]}
              raycast={() => {}}
            >
              <sphereGeometry args={[0.08, 12, 8]} />
              <meshBasicMaterial color="#0284c7" depthTest={false} />
            </mesh>
          )}
        </>,
        scene,
      )}
      <RampDraftControls
        finish={finish}
        previewError={frame ? previewError : 'Choose a Site before drawing a ramp.'}
        view="3d"
      />
    </>
  )
}
