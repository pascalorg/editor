'use client'

import {
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  ShelfNode,
  useScene,
} from '@pascal-app/core'
import {
  getFloorStackPreviewPosition,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { shelfDefinition } from './definition'
import ShelfPreview from './preview'

const ShelfTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)

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
        name: 'Shelf',
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    cursorVisibleRef.current = false
    setCursorVisible(false)
    /**
     * Snapped cursor position from the latest `grid:move`. Used as the
     * commit position for ANY click variant (grid or node), so clicks
     * on vertical surfaces (other shelves, walls, etc.) still commit
     * where the user was visually targeting.
     */
    const lastCursorRef: { current: [number, number, number] | null } = { current: null }

    // Alignment candidates — anchors of every OTHER alignable object (items,
    // walls, fences, slabs, ceilings, columns, other shelves). Gathered once
    // here and refreshed after each placement so a just-placed shelf becomes a
    // target for the next one. `previewNode.id` never collides with a scene
    // node, so nothing real is excluded.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)

    const onGridMove = (event: GridEvent) => {
      if (!cursorVisibleRef.current) {
        cursorVisibleRef.current = true
        setCursorVisible(true)
      }

      const { position, guides } = resolveAlignedFloorPlacement({
        node: previewNode,
        rawX: event.localPosition[0],
        rawZ: event.localPosition[2],
        gridStep: useEditor.getState().gridSnapStep,
        candidates: alignmentCandidates,
        showAlignment: isAlignmentGuideActive(),
        applyAlignmentSnap: isMagneticSnapActive(),
        bypassGrid: !isGridSnapActive(),
      })
      useAlignmentGuides.getState().set(guides)

      const visualPosition = getFloorStackPreviewPosition({
        node: previewNode,
        position,
        rotation: previewNode.rotation,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visualPosition)
      lastCursorRef.current = position

      const prev = previousSnapRef.current
      if (!prev || prev[0] !== position[0] || prev[1] !== position[2]) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [position[0], position[2]]
      }
    }

    const commitAtCursor = (event: FloorPlacementClickTriggerEvent) => {
      // Prefer the latest `grid:move` cursor snapshot; fall back to
      // projecting the click event into level-local coords if no
      // grid:move has fired yet (e.g. cursor entered via a node hit
      // first). Both paths apply the same grid snap.
      const position =
        lastCursorRef.current ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const shelf = ShelfNode.parse({
        ...shelfDefinition.defaults(),
        name: 'Shelf',
        position,
        rotation: [0, 0, 0],
      })
      useScene.getState().createNode(shelf, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [shelf.id] })
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
      if (useEditor.getState().getContinuation('point') === 'repeat') {
        // The placed shelf is now a valid alignment target for the next one.
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
      } else {
        cursorVisibleRef.current = false
        setCursorVisible(false)
        useEditor.getState().setTool(null)
      }

      stopPlacementCommitPropagation(event)
    }

    emitter.on('grid:move', onGridMove)
    const unsubscribePlacementClicks = subscribeFloorPlacementClicks(commitAtCursor)

    return () => {
      emitter.off('grid:move', onGridMove)
      unsubscribePlacementClicks()
      // Drop any alignment guide left over when the tool deactivates (kind
      // switch, Esc, unmount) so it doesn't linger over the canvas.
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <ShelfPreview node={previewNode} />
    </group>
  )
}

export default ShelfTool
