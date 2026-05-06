import '../../../three-types'

import {
  type AnyNodeId,
  ColumnNode,
  type ColumnNode as ColumnNodeType,
  emitter,
  type GridEvent,
  sceneRegistry,
  useLiveTransforms,
  useScene,
} from '@pascal-app/core'
import { useCallback, useEffect, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

const roundToHalf = (value: number) => Math.round(value * 2) / 2

export function MoveColumnTool({ node }: { node: ColumnNodeType }) {
  const [previewPosition, setPreviewPosition] = useState<[number, number, number]>(node.position)

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    useScene.temporal.getState().pause()
    let committed = false

    const applyPreview = (position: [number, number, number]) => {
      setPreviewPosition(position)
      useLiveTransforms.getState().set(node.id, {
        position,
        rotation: node.rotation,
      })
      sceneRegistry.nodes.get(node.id)?.position.set(position[0], position[1], position[2])
    }

    const onGridMove = (event: GridEvent) => {
      applyPreview([roundToHalf(event.localPosition[0]), 0, roundToHalf(event.localPosition[2])])
    }

    const onGridClick = (event: GridEvent) => {
      const position: [number, number, number] = [
        roundToHalf(event.localPosition[0]),
        0,
        roundToHalf(event.localPosition[2]),
      ]
      const nodeId = (node as { id?: ColumnNodeType['id'] }).id

      if (nodeId && useScene.getState().nodes[nodeId]) {
        committed = true
        useLiveTransforms.getState().clear(nodeId)
        useScene.temporal.getState().resume()
        useScene.getState().updateNode(nodeId, { position })
      } else if (node.parentId) {
        const column = ColumnNode.parse({
          ...node,
          id: undefined,
          metadata: {},
          position,
        })
        committed = true
        useScene.temporal.getState().resume()
        useScene.getState().createNode(column, node.parentId as AnyNodeId)
      }

      useLiveTransforms.getState().clear(node.id)
      sfxEmitter.emit('sfx:item-place')
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      useLiveTransforms.getState().clear(node.id)
      sceneRegistry.nodes
        .get(node.id)
        ?.position.set(node.position[0], node.position[1], node.position[2])
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
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
        sceneRegistry.nodes
          .get(node.id)
          ?.position.set(node.position[0], node.position[1], node.position[2])
        useScene.temporal.getState().resume()
      }
    }
  }, [exitMoveMode, node])

  return <CursorSphere color="#a78bfa" height={node.height} position={previewPosition} />
}
