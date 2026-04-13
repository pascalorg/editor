'use client'

import { type FenceNode, emitter, type GridEvent, sceneRegistry, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

function snap(value: number) {
  return Math.round(value * 2) / 2
}

export const MoveFenceTool: React.FC<{ node: FenceNode }> = ({ node }) => {
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const originalStartRef = useRef<[number, number]>([...node.start] as [number, number])
  const originalEndRef = useRef<[number, number]>([...node.end] as [number, number])
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const nodeIdRef = useRef(node.id)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const centerX = (node.start[0] + node.end[0]) / 2
    const centerZ = (node.start[1] + node.end[1]) / 2
    return [centerX, 0, centerZ]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const nodeId = nodeIdRef.current
    const originalStart = originalStartRef.current
    const originalEnd = originalEndRef.current
    const mesh = sceneRegistry.nodes.get(nodeId)

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const updatePreview = (nextStart: [number, number], nextEnd: [number, number]) => {
      const centerX = (nextStart[0] + nextEnd[0]) / 2
      const centerZ = (nextStart[1] + nextEnd[1]) / 2
      setCursorLocalPos([centerX, 0, centerZ])

      if (mesh) {
        mesh.position.set(centerX, 0, centerZ)
      }
    }

    const onGridMove = (event: GridEvent) => {
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])

      if (
        previousGridPosRef.current &&
        (localX !== previousGridPosRef.current[0] || localZ !== previousGridPosRef.current[1])
      ) {
        sfxEmitter.emit('sfx:grid-snap')
      }
      previousGridPosRef.current = [localX, localZ]

      const anchor = dragAnchorRef.current ?? [localX, localZ]
      dragAnchorRef.current = anchor

      const deltaX = localX - anchor[0]
      const deltaZ = localZ - anchor[1]

      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      updatePreview(nextStart, nextEnd)
    }

    const onGridClick = (event: GridEvent) => {
      const anchor = dragAnchorRef.current
      const localX = snap(event.localPosition[0])
      const localZ = snap(event.localPosition[2])
      const baseAnchor: [number, number] = anchor ?? [localX, localZ]
      const deltaX = localX - baseAnchor[0]
      const deltaZ = localZ - baseAnchor[1]

      const nextStart: [number, number] = [originalStart[0] + deltaX, originalStart[1] + deltaZ]
      const nextEnd: [number, number] = [originalEnd[0] + deltaX, originalEnd[1] + deltaZ]

      wasCommitted = true
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(nodeId, { start: nextStart, end: nextEnd })
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      if (mesh) {
        const centerX = (originalStart[0] + originalEnd[0]) / 2
        const centerZ = (originalStart[1] + originalEnd[1]) / 2
        mesh.position.set(centerX, 0, centerZ)
      }
      useViewer.getState().setSelection({ selectedIds: [nodeId] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        useScene.getState().updateNode(nodeId, { start: originalStart, end: originalEnd })
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}
