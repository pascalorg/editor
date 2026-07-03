'use client'

import {
  emitter,
  type GridEvent,
  SpawnNode,
  sceneRegistry,
  snapScalar,
  useScene,
} from '@pascal-app/core'
import { CursorSphere, triggerSFX, useEditor } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'

const snapToGrid = (value: number) => snapScalar(value, useEditor.getState().gridSnapStep)
const worldVector = new Vector3()

function getExistingSpawnIds() {
  const nodes = useScene.getState().nodes
  return Object.values(nodes)
    .filter((node) => node.type === 'spawn')
    .map((node) => node.id)
    .sort()
}

function getLevelLocalPosition(levelId: string, event: GridEvent): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  const bypassSnap = event.nativeEvent?.shiftKey === true
  if (!levelObject) {
    return [
      bypassSnap ? event.localPosition[0] : snapToGrid(event.localPosition[0]),
      event.localPosition[1],
      bypassSnap ? event.localPosition[2] : snapToGrid(event.localPosition[2]),
    ]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  return [
    bypassSnap ? worldVector.x : snapToGrid(worldVector.x),
    worldVector.y,
    bypassSnap ? worldVector.z : snapToGrid(worldVector.z),
  ]
}

/**
 * Registry-driven spawn placement tool. Reads `activeLevelId` from useViewer
 * directly (no props), broadcasts placement via store updates + SFX, and
 * uses the shared CursorSphere from @pascal-app/editor for visual parity
 * with legacy placement tools.
 */
const SpawnTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null

    const onGridMove = (event: GridEvent) => {
      // Cursor lives in the ToolManager's building-local group. Use
      // event.localPosition directly (already building-local), snapped to the
      // editor's configured grid step.
      const bypassSnap = event.nativeEvent?.shiftKey === true
      const nextX = bypassSnap ? event.localPosition[0] : snapToGrid(event.localPosition[0])
      const nextZ = bypassSnap ? event.localPosition[2] : snapToGrid(event.localPosition[2])
      cursorRef.current?.position.set(nextX, event.localPosition[1], nextZ)

      // Fire grid-snap SFX only when the snapped position crosses a cell,
      // not every frame the mouse moves within the same cell. Matches the
      // wall / slab / curve tools.
      const prev = previousSnapRef.current
      if (!prev || prev[0] !== nextX || prev[1] !== nextZ) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [nextX, nextZ]
      }
    }

    const onGridClick = (event: GridEvent) => {
      const next = getLevelLocalPosition(activeLevelId, event)
      const [existingSpawnId, ...duplicates] = getExistingSpawnIds()
      let placedId: SpawnNode['id']

      if (existingSpawnId) {
        useScene.getState().updateNode(existingSpawnId, {
          parentId: activeLevelId,
          position: next,
          rotation: 0,
        })
        if (duplicates.length > 0) {
          useScene.getState().deleteNodes(duplicates)
        }
        placedId = existingSpawnId
      } else {
        const spawn = SpawnNode.parse({
          name: 'Spawn Point',
          position: next,
          rotation: 0,
        })
        useScene.getState().createNode(spawn, activeLevelId)
        placedId = spawn.id
      }

      useViewer.getState().setSelection({ selectedIds: [placedId] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  return <CursorSphere color="#818cf8" height={2.2} ref={cursorRef} />
}

export default SpawnTool
