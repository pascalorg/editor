'use client'

import { emitter, type GridEvent, resolveSiteGround } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
  subscribeFloorPlacementDoubleClicks,
} from '../shared/floor-placement'
import { GardenDraftPreview } from '../shared/garden-draft-preview'
import { siteFrame } from '../shared/site-frame'
import { gridEventSiteGround } from '../shared/site-pointer-ground'
import { snapPlantingDraftPoint, usePlantingDraft, usePlantingDraftController } from './draft'

export default function PlantingTool() {
  const context = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const { addPoint, finish, error } = usePlantingDraftController({
    ...context,
    siteId: frame?.site.id,
    finishTool,
    view: '3d',
  })
  useEffect(() => {
    const owns = (native?: { target: EventTarget | null }) =>
      visibleScene(useEditor.getState()) !== '2d' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      native?.target instanceof HTMLCanvasElement &&
      !context.isCameraDragging()
    // Under the pointer's own ray, not on the active floor's plane (see `sitePointerGround`).
    const groundUnder = (event: Parameters<typeof gridEventSiteGround>[0]) => {
      const site = siteFrame(context.sceneApi, context.activeLevelId)?.site ?? null
      const ground = resolveSiteGround(site?.id, context.sceneApi.nodes())
      return gridEventSiteGround(event, camera, canvas, site, ground)
    }
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent)) return
      const point = snapPlantingDraftPoint(groundUnder(event), event.nativeEvent?.altKey)
      usePlantingDraft.setState({ hover: point })
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!owns(event.nativeEvent)) return
      stopPlacementCommitPropagation(event)
      // A wall-face click commits the ground cursor, not the point halfway up the wall.
      const point =
        'node' in event
          ? usePlantingDraft.getState().hover
          : snapPlantingDraftPoint(groundUnder(event), event.nativeEvent?.altKey)
      if (point) addPoint(point)
    })
    // The second click of a double-click repeats the last point and is dropped; the outline closes.
    const stopDoubleClicks = subscribeFloorPlacementDoubleClicks((event) => {
      if (!owns(event.nativeEvent)) return
      stopPlacementCommitPropagation(event)
      finish()
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
      stopDoubleClicks()
    }
  }, [
    addPoint,
    finish,
    context.isCameraDragging,
    context.sceneApi,
    context.activeLevelId,
    camera,
    canvas,
  ])
  const points = usePlantingDraft((draft) => draft.points)
  const hover = usePlantingDraft((draft) => draft.hover)
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  const first = points[0]
  // ToolManager mounts under the active building; the Site-space guide must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenDraftPreview
        closed
        ground={ground}
        hover={hover}
        invalid={!!error}
        lift={0.05}
        points={points}
      />
      {error && first && (
        <Html
          position={[first[0], ground.heightAt(first[0], first[1]) + 0.05, first[1]]}
          style={{ pointerEvents: 'none', width: 260 }}
        >
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {error}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
