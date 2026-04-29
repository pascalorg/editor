import '../../../three-types'

import {
  emitter,
  type GridEvent,
  type SpawnNode,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useCallback, useEffect, useState } from 'react'
import { Vector3 } from 'three'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2
const worldVector = new Vector3()

function getLevelLocalSpawnPosition(node: SpawnNode, event: GridEvent): [number, number, number] {
  const levelObject = node.parentId ? sceneRegistry.nodes.get(node.parentId) : null
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

export const MoveSpawnTool: React.FC<{
  node: SpawnNode
  onCommitted?: (nodeId: SpawnNode['id']) => void
}> = ({ node, onCommitted }) => {
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(node.position)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()

    let committed = false

    const onGridMove = (event: GridEvent) => {
      const nextPosition: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        event.localPosition[1],
        roundToHalf(event.localPosition[2]),
      ]
      setPreviewPosition(nextPosition)
      useLiveTransforms.getState().set(node.id, {
        position: [...nextPosition],
        rotation: node.rotation,
      })
    }

    const onGridClick = (event: GridEvent) => {
      const nextPosition = getLevelLocalSpawnPosition(node, event)

      committed = true
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(node.id, { position: nextPosition })
      onCommitted?.(node.id)
      useLiveTransforms.getState().clear(node.id)
      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(node.id)
      useScene.temporal.getState().resume()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
      useLiveTransforms.getState().clear(node.id)
      if (!committed) {
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node, onCommitted])

  return (
    <CursorSphere color="#60a5fa" height={2.2} position={previewPosition} showTooltip={false} />
  )
}
