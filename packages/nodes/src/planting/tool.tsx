'use client'

import { emitter, type GridEvent, resolveSiteGround } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { GardenPreviewLine } from '../shared/garden-preview-line'
import { siteFrame } from '../shared/site-frame'
import { snapPlantingDraftPoint, usePlantingDraft, usePlantingDraftController } from './draft'

export default function PlantingTool() {
  const context = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const { addPoint, line, error } = usePlantingDraftController({
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
    const move = (event: GridEvent) => {
      if (!owns(event.nativeEvent)) return
      const point = snapPlantingDraftPoint(
        [event.position[0], event.position[2]],
        event.nativeEvent?.altKey,
      )
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
          : snapPlantingDraftPoint(
              [event.position[0], event.position[2]],
              event.nativeEvent?.altKey,
            )
      if (point) addPoint(point)
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
    }
  }, [addPoint, context.isCameraDragging])
  if (line.length < 2) return null
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  const closed = line.length >= 3 ? [...line, line[0]!] : line
  const points = closed.map(([x, z]): [number, number, number] => [
    x,
    ground.heightAt(x, z) + 0.05,
    z,
  ])
  // ToolManager mounts under the active building; the Site-space guide must not inherit it.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <GardenPreviewLine color={error ? '#b45309' : '#3f8f3a'} lineWidth={3} points={points} />
      {error && (
        <Html position={points[0]} style={{ pointerEvents: 'none', width: 260 }}>
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {error}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
