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
import { useEffect, useMemo, useRef } from 'react'
import { type Group, Vector3 } from 'three'
import ShelfPreview from './preview'

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

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)

  // Default-shaped shelf for the placement preview. Same shape the move tool
  // uses (both reach for `shelfDefinition.preview`) so placement and move
  // look identical.
  const previewNode = useMemo(
    () => ShelfNode.parse({ name: 'Shelf', position: [0, 0, 0], rotation: [0, 0, 0] }),
    [],
  )

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
      const position = getLevelLocalPosition(activeLevelId, event)
      const shelf = ShelfNode.parse({
        name: 'Shelf',
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(shelf, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [shelf.id] })
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

  // Cursor preview: defers to the shared ShelfPreview component used by the
  // move tool too. Position is updated imperatively via the ref; no React
  // state, no re-render cycles.
  return (
    <group ref={cursorRef}>
      <ShelfPreview node={previewNode} />
    </group>
  )
}

export default ShelfTool
