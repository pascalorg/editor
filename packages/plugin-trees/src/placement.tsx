'use client'

import { emitter, type GridEvent, sceneRegistry, snapPointToGrid } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'
import { draftElevation } from './elevation'

const worldVec = new Vector3()

/** Snap a planar position to the grid when grid snapping is the active mode —
 * reading the same `isGridSnapActive()` toggle + `gridSnapStep` the built-in
 * item/shelf tools use, so plants honour the snap mode like every other item. */
export function snapXZ(x: number, z: number): readonly [number, number] {
  const editor = useEditor.getState() as ReturnType<typeof useEditor.getState> & {
    snappingModeByContext?: { item?: string }
  }
  const gridActive = editor.snappingModeByContext
    ? editor.snappingModeByContext.item === 'grid'
    : editor.magneticSnap
  if (!gridActive) return [x, z]
  return snapPointToGrid([x, z], editor.gridSnapStep)
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
 *
 * `previewNode` is the draft the tool is about to place. It exists only so the
 * ghost can be raised onto whatever it will actually land on — the floor
 * resolver reads the kind's `floorPlaced` footprint off the node, so a plain
 * position is not enough to ask the question. Tools that omit it get a ghost
 * pinned to the storey plane.
 */
export function usePlacement(
  activeLevelId: string | null,
  onCommit: (levelLocalPosition: [number, number, number]) => void,
  previewNode?: unknown,
) {
  const cursorRef = useRef<Group>(null)
  const [cursorVisible, setCursorVisible] = useState(false)
  const commitRef = useRef(onCommit)
  commitRef.current = onCommit
  const previewRef = useRef(previewNode)
  previewRef.current = previewNode

  useEffect(() => {
    if (!activeLevelId) return
    setCursorVisible(false)
    let lastWorld: [number, number, number] | null = null

    /**
     * Where the ghost stands: the snapped point raised onto the surface the
     * commit will elect — a stacked slab, or the sculpted ground. The commit
     * itself stays flat (`[x, 0, z]`); the lift is presentation, applied to the
     * stored base by the host's floor-elevation pass once the node exists. A
     * ghost that skipped this floated at the storey plane over a deck and sank
     * into every hillside, so the plant jumped on click.
     */
    const ghostY = (x: number, z: number): number => {
      const node = previewRef.current
      return node ? draftElevation(node, activeLevelId, [x, 0, z]) : 0
    }

    const onMove = (event: GridEvent) => {
      setCursorVisible(true)
      const [lx, , lz] = event.localPosition
      const [sx, sz] = snapXZ(lx, lz)
      cursorRef.current?.position.set(sx, ghostY(sx, sz), sz)
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
