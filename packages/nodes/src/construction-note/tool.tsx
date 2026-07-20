'use client'

import {
  type AnyNodeId,
  ConstructionNoteNode,
  emitter,
  type FloorplanPoint,
  type GridEvent,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Line } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { constructionNoteDefinition } from './definition'
import { constructionNoteTargetPoint } from './resolve'

function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value
}

const ConstructionNoteTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const cursorRef = useRef<Group>(null)
  const [cursor, setCursor] = useState<FloorplanPoint | null>(null)
  const selectedAttachment = useMemo(() => {
    if (!selectedId) return null
    const nodes = useScene.getState().nodes
    const target = nodes[selectedId as AnyNodeId]
    if (!target || target.type === 'construction-note') return null
    const point = constructionNoteTargetPoint(target, (id) => nodes[id])
    return point ? { targetId: target.id, point } : null
  }, [selectedId])
  const [anchor, setAnchor] = useState<FloorplanPoint | null>(selectedAttachment?.point ?? null)

  useEffect(() => {
    if (!activeLevelId) return

    const resolvePoint = (event: GridEvent): FloorplanPoint => {
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      return [snap(event.localPosition[0], step), snap(event.localPosition[2], step)]
    }

    const onMove = (event: GridEvent) => {
      const point = resolvePoint(event)
      setCursor(point)
      cursorRef.current?.position.set(point[0], 0, point[1])
    }

    const onClick = (event: GridEvent) => {
      const point = resolvePoint(event)
      if (!anchor) {
        setAnchor(point)
        triggerSFX('sfx:grid-snap')
        return
      }

      const note = ConstructionNoteNode.parse({
        ...constructionNoteDefinition.defaults(),
        name: 'Construction Note',
        anchor,
        textPosition: point,
        targetId: selectedAttachment?.targetId ?? null,
        targetOffset: [0, 0],
      })
      useScene.getState().createNode(note, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [note.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (anchor && !selectedAttachment) {
        event.preventDefault()
        markToolCancelConsumed()
        setAnchor(null)
        return
      }
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, anchor, selectedAttachment])

  if (!activeLevelId) return null

  return (
    <>
      <CursorSphere color="#334155" height={0.12} ref={cursorRef} />
      {anchor && cursor ? (
        <Line
          color="#334155"
          depthTest={false}
          lineWidth={1.2}
          points={[
            [anchor[0], 0.03, anchor[1]],
            [cursor[0], 0.03, cursor[1]],
          ]}
        />
      ) : null}
    </>
  )
}

export default ConstructionNoteTool
