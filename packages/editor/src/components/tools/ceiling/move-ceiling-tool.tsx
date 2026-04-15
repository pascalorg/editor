'use client'

import { type AnyNodeId, emitter, type GridEvent, useScene, type CeilingNode } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { markToolCancelConsumed } from '../../../hooks/use-keyboard'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor from '../../../store/use-editor'
import { CursorSphere } from '../shared/cursor-sphere'

function snap(value: number) {
  return Math.round(value * 2) / 2
}

function translatePolygon(
  polygon: Array<[number, number]>,
  deltaX: number,
  deltaZ: number,
): Array<[number, number]> {
  return polygon.map(([x, z]) => [x + deltaX, z + deltaZ] as [number, number])
}

function getPolygonCenter(polygon: Array<[number, number]>): [number, number] {
  if (polygon.length === 0) return [0, 0]
  let sumX = 0
  let sumZ = 0
  for (const [x, z] of polygon) {
    sumX += x
    sumZ += z
  }
  return [sumX / polygon.length, sumZ / polygon.length]
}

export const MoveCeilingTool: React.FC<{ node: CeilingNode }> = ({ node }) => {
  const activatedAtRef = useRef<number>(Date.now())
  const originalPolygonRef = useRef(node.polygon.map(([x, z]) => [x, z] as [number, number]))
  const originalHolesRef = useRef(
    (node.holes ?? []).map((hole) => hole.map(([x, z]) => [x, z] as [number, number])),
  )
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const previousGridPosRef = useRef<[number, number] | null>(null)
  const previewRef = useRef<{
    polygon: Array<[number, number]>
    holes: Array<Array<[number, number]>>
  } | null>(null)

  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const center = getPolygonCenter(node.polygon)
    return [center[0], node.height ?? 2.5, center[1]]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => {
    const originalPolygon = originalPolygonRef.current
    const originalHoles = originalHolesRef.current

    useScene.temporal.getState().pause()
    let wasCommitted = false

    const applyPreview = (
      polygon: Array<[number, number]>,
      holes: Array<Array<[number, number]>>,
    ) => {
      previewRef.current = { polygon, holes }
      const center = getPolygonCenter(polygon)
      setCursorLocalPos([center[0], node.height ?? 2.5, center[1]])
      useScene.getState().updateNode(node.id, { polygon, holes })
      useScene.getState().markDirty(node.id as AnyNodeId)
    }

    const restoreOriginal = () => {
      useScene.getState().updateNode(node.id, {
        holes: originalHoles,
        polygon: originalPolygon,
      })
      useScene.getState().markDirty(node.id as AnyNodeId)
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

      applyPreview(
        translatePolygon(originalPolygon, deltaX, deltaZ),
        originalHoles.map((hole) => translatePolygon(hole, deltaX, deltaZ)),
      )
    }

    const onGridClick = (event: GridEvent) => {
      if (Date.now() - activatedAtRef.current < 150) {
        event.nativeEvent?.stopPropagation?.()
        return
      }

      const preview = previewRef.current ?? { polygon: originalPolygon, holes: originalHoles }

      wasCommitted = true
      useScene.temporal.getState().resume()
      useScene.getState().updateNode(node.id, preview)
      useScene.getState().markDirty(node.id as AnyNodeId)
      useScene.temporal.getState().pause()

      sfxEmitter.emit('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      exitMoveMode()
      event.nativeEvent?.stopPropagation?.()
    }

    const onCancel = () => {
      restoreOriginal()
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      useScene.temporal.getState().resume()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    emitter.on('tool:cancel', onCancel)

    return () => {
      if (!wasCommitted) {
        restoreOriginal()
      }
      useScene.temporal.getState().resume()
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      emitter.off('tool:cancel', onCancel)
    }
  }, [exitMoveMode, node.height, node.id])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
    </group>
  )
}
