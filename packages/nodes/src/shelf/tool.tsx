'use client'

import {
  emitter,
  type GridEvent,
  ShelfNode,
  sceneRegistry,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'

const worldVector = new Vector3()
const GRID_STEP = 0.5

/**
 * Convert a click into the shelf's commit position (level-local). The shelf
 * node's `position` field is stored relative to its level parent, so we
 * project the click point into the level's local frame before storing.
 *
 * Cursor display uses event.localPosition (building-local) — see onGridMove.
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

// Cursor preview dimensions — match the shelf's default schema dimensions.
// Once the shelf has user-tunable defaults in the inspector, this can pull
// from the active draft.
const PREVIEW_WIDTH = 1.2
const PREVIEW_DEPTH = 0.3
const PREVIEW_THICKNESS = 0.04
const PREVIEW_HEIGHT = 0.9
const PREVIEW_INSET = Math.min(0.12, PREVIEW_WIDTH / 6)
const PREVIEW_BRACKET_WIDTH = Math.max(0.02, PREVIEW_DEPTH * 0.12)
const PREVIEW_BRACKET_DEPTH = PREVIEW_DEPTH * 0.7

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!activeLevelId) return

    const onGridMove = (event: GridEvent) => {
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
      triggerSFX('sfx:structure-build')
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

  // Cursor preview: ghostly version of the full shelf (top board + brackets)
  // so the user sees the same shape they're placing. Position is updated
  // imperatively via the ref; no React state, no re-render cycles.
  return (
    <group ref={cursorRef}>
      {/* Top board */}
      <mesh position={[0, PREVIEW_HEIGHT + PREVIEW_THICKNESS / 2, 0]}>
        <boxGeometry args={[PREVIEW_WIDTH, PREVIEW_THICKNESS, PREVIEW_DEPTH]} />
        <meshStandardMaterial color="#a07050" transparent opacity={0.5} />
      </mesh>
      {/* Left bracket */}
      <mesh position={[-(PREVIEW_WIDTH / 2 - PREVIEW_INSET), PREVIEW_HEIGHT / 2, 0]}>
        <boxGeometry args={[PREVIEW_BRACKET_WIDTH, PREVIEW_HEIGHT, PREVIEW_BRACKET_DEPTH]} />
        <meshStandardMaterial color="#a07050" transparent opacity={0.5} />
      </mesh>
      {/* Right bracket */}
      <mesh position={[PREVIEW_WIDTH / 2 - PREVIEW_INSET, PREVIEW_HEIGHT / 2, 0]}>
        <boxGeometry args={[PREVIEW_BRACKET_WIDTH, PREVIEW_HEIGHT, PREVIEW_BRACKET_DEPTH]} />
        <meshStandardMaterial color="#a07050" transparent opacity={0.5} />
      </mesh>
    </group>
  )
}

export default ShelfTool
