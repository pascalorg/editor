'use client'

import { emitter, type GridEvent, sceneRegistry, snapPointToGrid } from '@pascal-app/core'
import { isGridSnapActive, useEditor } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'

const worldVec = new Vector3()

/** Snap a planar position to the grid when grid snapping is the active mode —
 * reading the same `isGridSnapActive()` toggle + `gridSnapStep` the built-in
 * item/shelf tools use, so plants honour the snap mode like every other item. */
export function snapXZ(x: number, z: number): readonly [number, number] {
  if (!isGridSnapActive()) return [x, z]
  return snapPointToGrid([x, z], useEditor.getState().gridSnapStep)
}

/**
 * Convert a world-space grid hit into the active level's local frame, the way
 * the host stores node positions. Re-derived from the public `sceneRegistry`
 * because the built-in `floor-placement` helpers aren't part of the public
 * `@pascal-app/*` surface yet — a candidate for a future `@pascal-app/plugin-api`.
 */
export function toLevelLocal(
  levelId: string,
  world: [number, number, number],
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) return [world[0], 0, world[2]]
  worldVec.set(world[0], world[1], world[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVec)
  return [worldVec.x, 0, worldVec.z]
}

/**
 * Shared placement wiring for any plant tool: ghosts a preview at the snapped
 * cursor on `grid:move`, and calls `onCommit` with the snapped level-local
 * position on `grid:click`. Returns the cursor group ref + visibility for the
 * tool to attach its preview to. `onCommit` is read through a ref so a tool can
 * close over live brush state without re-subscribing every render.
 */
export function usePlacement(
  activeLevelId: string | null,
  onCommit: (levelLocalPosition: [number, number, number]) => void,
) {
  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    let lastWorld: [number, number, number] | null = null

    const onMove = (event: GridEvent) => {
      setCursorVisible(true)
      const [lx, , lz] = event.localPosition
      const [sx, sz] = snapXZ(lx, lz)
      cursorRef.current?.position.set(sx, 0, sz)
      lastWorld = event.position
    }

    const onClick = (event: GridEvent) => {
      const world = lastWorld ?? event.position
      const [lx, , lz] = toLevelLocal(activeLevelId, world)
      const [sx, sz] = snapXZ(lx, lz)
      commitRef.current([sx, 0, sz])
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
    }
  }, [activeLevelId])

  return { cursorRef, cursorVisible }
}
