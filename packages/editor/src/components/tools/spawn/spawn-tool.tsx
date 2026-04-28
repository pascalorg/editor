import '../../../three-types'

import {
  emitter,
  type GridEvent,
  type LevelNode,
  sceneRegistry,
  SpawnNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import { Vector3 } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const SPAWN_ICON = (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    alt="Spawn Point"
    src="/icons/spawn-point.svg"
    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
  />
)

const roundToHalf = (value: number) => Math.round(value * 2) / 2
const worldVector = new Vector3()

function getExistingSpawnIds() {
  const nodes = useScene.getState().nodes
  return Object.values(nodes)
    .filter((node) => node.type === 'spawn')
    .map((node) => node.id)
    .sort()
}

function getLevelLocalSpawnPosition(
  levelId: LevelNode['id'],
  event: GridEvent,
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    return [
      roundToHalf(event.localPosition[0]),
      event.localPosition[1],
      roundToHalf(event.localPosition[2]),
    ]
  }

  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)

  return [roundToHalf(worldVector.x), worldVector.y, roundToHalf(worldVector.z)]
}

export const SpawnTool: React.FC = () => {
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const [, setCursorPosition] = useState<[number, number, number] | null>(null)
  const cursorRef = useRef<Group>(null)

  useEffect(() => {
    if (!currentLevelId) return

    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        event.localPosition[1],
        roundToHalf(event.localPosition[2]),
      ]
      setCursorPosition(nextPosition)
      cursorRef.current?.position.set(nextPosition[0], nextPosition[1], nextPosition[2])
    }

    const onGridClick = (event: GridEvent) => {
      const nextPosition = getLevelLocalSpawnPosition(currentLevelId, event)

      const [existingSpawnId, ...duplicateSpawnIds] = getExistingSpawnIds()
      if (existingSpawnId) {
        useScene.getState().updateNode(existingSpawnId, {
          parentId: currentLevelId,
          position: nextPosition,
          rotation: 0,
        })
        if (duplicateSpawnIds.length > 0) {
          useScene.getState().deleteNodes(duplicateSpawnIds)
        }
        useViewer.getState().setSelection({ selectedIds: [existingSpawnId] })
      } else {
        const spawn = SpawnNode.parse({
          name: 'Spawn Point',
          position: nextPosition,
          rotation: 0,
        })
        useScene.getState().createNode(spawn, currentLevelId)
        useViewer.getState().setSelection({ selectedIds: [spawn.id] })
      }

      sfxEmitter.emit('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
    }
  }, [currentLevelId])

  if (!currentLevelId) return null

  return (
    <CursorSphere
      color="#60a5fa"
      height={2.2}
      ref={cursorRef}
      showTooltip
      tooltipContent={SPAWN_ICON}
    />
  )
}
