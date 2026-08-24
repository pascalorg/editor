'use client'

import { emitter, type GridEvent, sceneRegistry, snapPointToGrid } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { type Group, Vector3 } from 'three'

const worldPoint = new Vector3()

function snapXZ(x: number, z: number): readonly [number, number] {
  const editor = useEditor.getState() as ReturnType<typeof useEditor.getState> & {
    snappingModeByContext?: { item?: string }
  }
  const gridActive = editor.snappingModeByContext
    ? editor.snappingModeByContext.item === 'grid'
    : editor.magneticSnap
  return gridActive ? snapPointToGrid([x, z], editor.gridSnapStep) : [x, z]
}

function toLevelLocal(levelId: string, world: [number, number, number]): [number, number, number] {
  const level = sceneRegistry.nodes.get(levelId)
  if (!level) return [world[0], 0, world[2]]
  worldPoint.set(world[0], world[1], world[2])
  level.updateWorldMatrix(true, false)
  level.worldToLocal(worldPoint)
  return [worldPoint.x, 0, worldPoint.z]
}

export function useArticraftPlacement(
  activeLevelId: string | null,
  onCommit: (position: [number, number, number]) => void,
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
      const [x, , z] = event.localPosition
      const [snappedX, snappedZ] = snapXZ(x, z)
      cursorRef.current?.position.set(snappedX, 0, snappedZ)
      lastWorld = event.position
      setCursorVisible(true)
    }

    const onClick = (event: GridEvent) => {
      const local = toLevelLocal(activeLevelId, lastWorld ?? event.position)
      const [x, z] = snapXZ(local[0], local[2])
      commitRef.current([x, 0, z])
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
