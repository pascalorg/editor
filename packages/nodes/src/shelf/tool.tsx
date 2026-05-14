'use client'

import {
  emitter,
  type GridEvent,
  ShelfNode,
  sceneRegistry,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'

const worldVector = new Vector3()

function getLevelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], 0.1)
    return [sx, event.localPosition[1], sz]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  const [sx, sz] = snapPointToGrid([worldVector.x, worldVector.z], 0.1)
  return [sx, worldVector.y, sz]
}

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const [, setCursor] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const onGridMove = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], 0.1)
      const next: [number, number, number] = [sx, event.localPosition[1], sz]
      setCursor(next)
      cursorRef.current?.position.set(next[0], next[1], next[2])
    }

    const onGridClick = (event: GridEvent) => {
      const position = getLevelLocalPosition(activeLevelId, event)
      const shelf = ShelfNode.parse({
        name: 'Shelf',
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(shelf, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [shelf.id] })
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef}>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[1.2, 0.04, 0.3]} />
        <meshStandardMaterial color="#a07050" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

export default ShelfTool
