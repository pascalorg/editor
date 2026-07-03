'use client'

import { LadderNode, emitter, type GridEvent, sceneRegistry, snapPointToGrid, useScene } from '@pascal-app/core'
import { CursorSphere, triggerSFX } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'
import { ladderDefinition } from './definition'

const GRID_STEP = 0.5
const worldVector = new Vector3()

function levelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    const [x, z] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
    return [x, event.localPosition[1], z]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  const [x, z] = snapPointToGrid([worldVector.x, worldVector.z], GRID_STEP)
  return [x, worldVector.y, z]
}

export default function LadderTool() {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (!activeLevelId) return
    const onGridMove = (event: GridEvent) => {
      const [x, z] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      cursorRef.current?.position.set(x, event.localPosition[1], z)
      const prev = previousSnapRef.current
      if (!prev || prev[0] !== x || prev[1] !== z) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [x, z]
      }
    }
    const onGridClick = (event: GridEvent) => {
      const count = Object.values(useScene.getState().nodes).filter((node) => node.type === 'ladder').length
      const ladder = LadderNode.parse({
        ...ladderDefinition.defaults(),
        name: `Ladder ${count + 1}`,
        position: levelLocalPosition(activeLevelId, event),
      })
      useScene.getState().createNode(ladder, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [ladder.id] })
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
  return <CursorSphere color="#94a3b8" height={1.5} ref={cursorRef} />
}

