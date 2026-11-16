'use client'

import { emitter, type GridEvent } from '@pascal-app/core'
import { EDITOR_LAYER, useEditor, useRegistryToolContext } from '@pascal-app/editor'
import { Line } from '@react-three/drei'
import { useCallback, useEffect } from 'react'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import {
  TerrainBreakDraftControls,
  useTerrainBreakDraft,
  useTerrainBreakDraftController,
} from './draft'

export default function TerrainBreakTool() {
  const context = useRegistryToolContext()
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const { draft, line, addPoint } = useTerrainBreakDraftController({
    ...context,
    finishTool,
    view: '3d',
  })
  useEffect(() => {
    const isCanvasEvent = (native?: { target: EventTarget | null }) =>
      typeof HTMLCanvasElement !== 'undefined' && native?.target instanceof HTMLCanvasElement
    const move = (event: GridEvent) => {
      if (!isCanvasEvent(event.nativeEvent) || context.isCameraDragging()) return
      useTerrainBreakDraft.setState({ hover: [event.position[0], event.position[2]] })
    }
    emitter.on('grid:move', move)
    const unsubscribe = subscribeFloorPlacementClicks((event) => {
      if (!isCanvasEvent(event.nativeEvent) || context.isCameraDragging()) return
      stopPlacementCommitPropagation(event)
      addPoint([event.position[0], event.position[2]])
    })
    return () => {
      emitter.off('grid:move', move)
      unsubscribe()
    }
  }, [addPoint, context.isCameraDragging])
  const y =
    typeof draft.options.left === 'number'
      ? draft.options.left
      : typeof draft.options.right === 'number'
        ? draft.options.right
        : 0
  return (
    <>
      {line.length > 1 && (
        <Line
          color="#0284c7"
          depthTest={false}
          layers={EDITOR_LAYER}
          lineWidth={2}
          points={line.map(([x, z]) => [x, y + 0.03, z])}
          raycast={() => {}}
          userData={{ pascalExport: 'strip' }}
        />
      )}
      <TerrainBreakDraftControls view="3d" />
    </>
  )
}
