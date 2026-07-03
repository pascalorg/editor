'use client'

import {
  type AnyNode,
  type EventSuffix,
  emitter,
  type GridEvent,
  type NodeEvent,
  snapPointToGrid,
  SteelFrameNode,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { steelFrameDefinition } from './definition'
import SteelFramePreview from './preview'

const GRID_STEP = 0.5
const CLICK_TRIGGER_KINDS = [
  'steel-frame',
  'steel-beam',
  'tank',
  'pipe',
  'cable-tray',
  'conveyor-belt',
  'shelf',
  'item',
  'slab',
  'ceiling',
  'wall',
  'fence',
  'column',
  'roof',
  'roof-segment',
  'stair',
  'stair-segment',
] as const

type ClickTriggerEvent = GridEvent | NodeEvent<AnyNode>

function fallbackPosition(event: ClickTriggerEvent): [number, number, number] {
  const local = (event as GridEvent).localPosition
  const source = local ?? event.localPosition ?? event.position
  const [sx, sz] = snapPointToGrid([source[0], source[2]], GRID_STEP)
  return [sx, source[1] ?? 0, sz]
}

export default function SteelFrameTool() {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const previewNode = useMemo(
    () =>
      SteelFrameNode.parse({
        ...steelFrameDefinition.defaults(),
        name: '钢架',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    const lastCursorRef: { current: [number, number, number] | null } = { current: null }

    const onGridMove = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      cursorRef.current?.position.set(sx, event.localPosition[1], sz)
      lastCursorRef.current = [sx, event.localPosition[1], sz]
      const prev = previousSnapRef.current
      if (!prev || prev[0] !== sx || prev[1] !== sz) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [sx, sz]
      }
    }

    const commitAtCursor = (event: ClickTriggerEvent) => {
      const position = lastCursorRef.current ?? fallbackPosition(event)
      const count = Object.values(useScene.getState().nodes).filter(
        (node) => node.type === 'steel-frame',
      ).length
      const frame = SteelFrameNode.parse({
        ...steelFrameDefinition.defaults(),
        name: `钢架 ${count + 1}`,
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(frame, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [frame.id] })
      triggerSFX('sfx:structure-build')

      const native = (event as { nativeEvent?: unknown }).nativeEvent
      if (
        native &&
        typeof (native as { stopPropagation?: () => void }).stopPropagation === 'function'
      ) {
        ;(native as { stopPropagation: () => void }).stopPropagation()
      }
      const direct = (event as { stopPropagation?: () => void }).stopPropagation
      if (typeof direct === 'function') direct.call(event)
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', commitAtCursor)
    type ClickKey = `${(typeof CLICK_TRIGGER_KINDS)[number]}:${EventSuffix}`
    for (const kind of CLICK_TRIGGER_KINDS)
      emitter.on(`${kind}:click` as ClickKey, commitAtCursor as never)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', commitAtCursor)
      for (const kind of CLICK_TRIGGER_KINDS)
        emitter.off(`${kind}:click` as ClickKey, commitAtCursor as never)
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef}>
      <SteelFramePreview node={previewNode} />
    </group>
  )
}
