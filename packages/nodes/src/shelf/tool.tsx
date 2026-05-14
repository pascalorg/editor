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
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'

const worldVector = new Vector3()
const GRID_STEP = 0.5

/**
 * Convert a click event into the shelf's commit position (level-local). The
 * shelf node's `position` field is stored relative to its level parent, so
 * we project the click point into the level's local frame before storing.
 *
 * Different from the cursor preview path: the cursor lives inside the
 * ToolManager's building-local group and snaps to `event.localPosition`
 * directly. This conversion only applies to the *committed* data.
 */
function getLevelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
    return [sx, event.localPosition[1], sz]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  const [sx, sz] = snapPointToGrid([worldVector.x, worldVector.z], GRID_STEP)
  return [sx, worldVector.y, sz]
}

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const onGridMove = (event: GridEvent) => {
      // Cursor lives in the ToolManager's building-local group. Use
      // `event.localPosition` (already building-local) so the visual cursor
      // sits where the mouse hits the floor. Legacy spawn-tool does the
      // same — don't apply worldToLocal here.
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      cursorRef.current?.position.set(sx, event.localPosition[1], sz)
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
      // biome-ignore lint/suspicious/noConsole: dev-only verification log
      console.info('[shelf] placed', shelf.id, 'level-local', position, 'parent', activeLevelId)
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
