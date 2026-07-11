'use client'

import {
  collectAlignmentAnchors,
  emitter,
  FireplaceNode,
  type GridEvent,
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
import { fireplaceDefinition } from './definition'
import FireplacePreview from './preview'

const FireplaceTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)

  const previewNode = useMemo(
    () =>
      FireplaceNode.parse({
        ...fireplaceDefinition.defaults(),
        name: 'Fireplace',
        position: [0, 0, 0],
        rotation: 0,
      }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    cursorVisibleRef.current = false
    setCursorVisible(false)
    const lastCursorRef: { current: [number, number, number] | null } = { current: null }

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
      const position =
        lastCursorRef.current ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const fireplace = FireplaceNode.parse({
        ...fireplaceDefinition.defaults(),
        name: 'Fireplace',
        position,
        rotation: 0,
      })
      useScene.getState().createNode(fireplace, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [fireplace.id] })
      triggerSFX('sfx:item-place')
      useAlignmentGuides.getState().clear()
      if (useEditor.getState().getContinuation('point') === 'repeat') {
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
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <FireplacePreview node={previewNode} />
    </group>
  )
}

export default FireplaceTool
