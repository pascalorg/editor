'use client'

import {
  type AnyNode,
  type EventSuffix,
  emitter,
  type GridEvent,
  type NodeEvent,
  ShelfNode,
  sceneRegistry,
  snapPointToGrid,
  useScene,
} from '@pascal-app/core'
import { triggerSFX } from '@pascal-app/editor'
import useViewer from '@pascal-app/viewer/store'
import { useEffect, useMemo, useRef } from 'react'
import { type Group, Vector3 } from 'three'
import { shelfDefinition } from './definition'
import ShelfPreview from './preview'

const worldVector = new Vector3()
const GRID_STEP = 0.5

/**
 * Click-trigger kinds: when the user clicks ANY of these during shelf
 * placement, we commit at the latest cursor position. R3F's pointer
 * raycaster dispatches to the closest intersected mesh, so a click on
 * a wall / slab / item / etc. would otherwise never reach `grid:click`
 * — the placement would silently drop. Listening for each kind's click
 * (and committing at the snapshot of the last `grid:move` cursor)
 * mirrors the fix in `MoveRegistryNodeTool`.
 */
const CLICK_TRIGGER_KINDS = [
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

/**
 * Convert the latest cursor world hit into level-local coords for the
 * commit `position`. The cursor's local position from `event.localPosition`
 * (building-local) needs to come back through the level's world transform
 * so the shelf is stored in its parent's frame.
 */
function getLevelLocalPosition(
  levelId: string,
  event: GridEvent | NodeEvent<AnyNode>,
): [number, number, number] {
  const levelObject = sceneRegistry.nodes.get(levelId)
  if (!levelObject) {
    const local = (event as GridEvent).localPosition
    if (local) {
      const [sx, sz] = snapPointToGrid([local[0], local[2]], GRID_STEP)
      return [sx, local[1] ?? 0, sz]
    }
    const [sx, sz] = snapPointToGrid([event.position[0], event.position[2]], GRID_STEP)
    return [sx, event.position[1], sz]
  }
  worldVector.set(event.position[0], event.position[1], event.position[2])
  levelObject.updateWorldMatrix(true, false)
  levelObject.worldToLocal(worldVector)
  const [sx, sz] = snapPointToGrid([worldVector.x, worldVector.z], GRID_STEP)
  return [sx, worldVector.y, sz]
}

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)

  // Default-shaped shelf for the placement preview. Pulls from
  // `shelfDefinition.defaults()` so the preview matches what the commit
  // will actually create (a 1m × 0.5m × 1.8m cubby 3x2 with closed back
  // + bottom). The schema-level defaults are deliberately the v1
  // wall-shelf — those exist so v1 scenes loading under v2 keep their
  // original visual; the placement default is a separate, user-facing
  // choice that lives on the definition.
  const previewNode = useMemo(
    () =>
      ShelfNode.parse({
        ...shelfDefinition.defaults(),
        name: '货架',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    /**
     * Snapped cursor position from the latest `grid:move`. Used as the
     * commit position for ANY click variant (grid or node), so clicks
     * on vertical surfaces (other shelves, walls, etc.) still commit
     * where the user was visually targeting.
     */
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
      // Prefer the latest `grid:move` cursor snapshot; fall back to
      // projecting the click event into level-local coords if no
      // grid:move has fired yet (e.g. cursor entered via a node hit
      // first). Both paths apply the same grid snap.
      const position = lastCursorRef.current ?? getLevelLocalPosition(activeLevelId, event)
      const shelf = ShelfNode.parse({
        ...shelfDefinition.defaults(),
        name: '货架',
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(shelf, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [shelf.id] })
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
      <ShelfPreview node={previewNode} />
    </group>
  )
}

export default ShelfTool
