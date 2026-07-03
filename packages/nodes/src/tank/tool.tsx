'use client'

import {
  type AnyNode,
  type EventSuffix,
  emitter,
  type GridEvent,
  type NodeEvent,
  snapPointToGrid,
  TankNode,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { tankDefinition } from './definition'
import { TankPreview } from './renderer'

const GRID_STEP = 0.5

const CLICK_TRIGGER_KINDS = [
  'tank',
  'pipe',
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

function getFallbackPosition(event: ClickTriggerEvent): [number, number, number] {
  const local = (event as GridEvent).localPosition
  if (local) {
    const [sx, sz] = snapPointToGrid([local[0], local[2]], GRID_STEP)
    return [sx, local[1] ?? 0, sz]
  }
  const [sx, sz] = snapPointToGrid([event.position[0], event.position[2]], GRID_STEP)
  return [sx, event.position[1], sz]
}

const TankTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const previewNode = useMemo(
    () =>
      TankNode.parse({
        ...tankDefinition.defaults(),
        name: 'Tank',
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
      const position = lastCursorRef.current ?? getFallbackPosition(event)
      const tank = TankNode.parse({
        ...tankDefinition.defaults(),
        name: 'Tank',
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(tank, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [tank.id] })
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
    type SuffixedKey<K extends string> = `${K}:${EventSuffix}`
    type ClickKey = SuffixedKey<(typeof CLICK_TRIGGER_KINDS)[number]>
    for (const kind of CLICK_TRIGGER_KINDS) {
      const key = `${kind}:click` as ClickKey
      emitter.on(key, commitAtCursor as never)
    }

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', commitAtCursor)
      for (const kind of CLICK_TRIGGER_KINDS) {
        const key = `${kind}:click` as ClickKey
        emitter.off(key, commitAtCursor as never)
      }
    }
  }, [activeLevelId])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef}>
      <TankPreview node={previewNode} />
    </group>
  )
}

export default TankTool
