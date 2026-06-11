'use client'

import { emitter, type GridEvent, SpawnNode, sceneRegistry, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  getFloorStackPreviewPosition,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef } from 'react'
import { type Group, Vector3 } from 'three'

const roundToHalf = (value: number) => Math.round(value * 2) / 2
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
  if (!levelObject) {
    return [roundToHalf(event.localPosition[0]), 0, roundToHalf(event.localPosition[2])]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  return [roundToHalf(worldVector.x), 0, roundToHalf(worldVector.z)]
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
      // event.localPosition directly (already building-local) with the
      // same half-meter snap the legacy tool uses.
      const nextX = roundToHalf(event.localPosition[0])
      const nextZ = roundToHalf(event.localPosition[2])
      const position: [number, number, number] = [nextX, 0, nextZ]
      const previewNode = SpawnNode.parse({
        name: 'Spawn Point',
        position,
        rotation: 0,
      })
      const visualPosition = getFloorStackPreviewPosition({
        node: previewNode,
        position,
        rotation: 0,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visualPosition)

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
