'use client'

import { emitter, type GridEvent, PipeFittingNode, snapPointToGrid, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import type { Group } from 'three'
import { pipeFittingDefinition } from './definition'

const GRID_STEP = 0.5
const DEFAULT_ELEVATION = 1

const PipeFittingTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null

    const onGridMove = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      cursorRef.current?.position.set(sx, event.localPosition[1], sz)

      const prev = previousSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [sx, sz]
      }
    }

    const onGridClick = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      const fitting = PipeFittingNode.parse({
        ...pipeFittingDefinition.defaults(),
        name: 'Pipe fitting',
        position: [sx, DEFAULT_ELEVATION, sz],
      })
      useScene.getState().createNode(fitting, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [fitting.id] })
      triggerSFX('sfx:structure-build')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  return <CursorSphere color="#38bdf8" height={DEFAULT_ELEVATION} ref={cursorRef} />
}

export default PipeFittingTool
