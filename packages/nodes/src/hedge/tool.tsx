'use client'

import { emitter, type GridEvent, resolveSiteGround } from '@pascal-app/core'
import { EDITOR_LAYER, useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html, Line } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { siteFrame } from '../shared/site-frame'
import { snapHedgeDraftPoint, useHedgeDraft, useHedgeDraftController } from './draft'

/** Canvas input and the SVG tool share one Site-space draft, never the same pointer event. */
export default function HedgeTool() {
  const context = useRegistryToolContext()
  const scene = useThree((state) => state.scene)
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const { addPoint, line, error } = useHedgeDraftController({
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
      useHedgeDraft.setState({
        hover: snapHedgeDraftPoint(
          [event.position[0], event.position[2]],
          event.nativeEvent?.altKey,
        ),
      })
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!owns(event.nativeEvent)) return
      stopPlacementCommitPropagation(event)
      const point =
        'node' in event
          ? useHedgeDraft.getState().hover
          : snapHedgeDraftPoint([event.position[0], event.position[2]], event.nativeEvent?.altKey)
      if (point) addPoint(point)
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
    }
  }, [addPoint, context.isCameraDragging])
  if (line.length < 2) return null
  const ground = resolveSiteGround(frame?.site.id, context.sceneApi.nodes())
  const points = line.map(([x, z]): [number, number, number] => [
    x,
    ground.heightAt(x, z) + 0.05,
    z,
  ])
  // ToolManager mounts under the building; a Site-space guide must not inherit its transform.
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      <Line
        color={error ? '#b45309' : '#3f8f3a'}
        depthTest={false}
        layers={EDITOR_LAYER}
        lineWidth={3}
        points={points}
        raycast={() => {}}
        userData={{ pascalExport: 'strip' }}
      />
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
