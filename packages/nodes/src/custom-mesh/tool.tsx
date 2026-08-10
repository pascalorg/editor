'use client'

import {
  CustomMeshNode,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  useScene,
} from '@pascal-app/core'
import {
  getFloorStackPreviewPosition,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  movementSfxStepKey,
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
import { customMeshDefinition } from './definition'
import CustomMeshPreview from './preview'

const CustomMeshTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<string | null>(null)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)
  const previewNode = useMemo(
    () =>
      CustomMeshNode.parse({
        ...customMeshDefinition.defaults(),
        name: 'Custom Mesh',
        position: [0, 0, 0],
      }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    let lastPosition: [number, number, number] | null = null
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
      lastPosition = position

      const snapKey = movementSfxStepKey({
        coords: [position[0], position[2]],
        gridSnapActive: isGridSnapActive(),
        gridStep: useEditor.getState().gridSnapStep,
      })
      if (snapKey !== previousSnapRef.current) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = snapKey
      }
    }

    const commit = (event: FloorPlacementClickTriggerEvent) => {
      const position =
        lastPosition ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const node = CustomMeshNode.parse({
        ...customMeshDefinition.defaults(),
        name: 'Custom Mesh',
        parentId: activeLevelId,
        position,
      })
      useScene.getState().createNode(node, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      triggerSFX('sfx:structure-build')
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
    const unsubscribe = subscribeFloorPlacementClicks(commit)
    return () => {
      emitter.off('grid:move', onGridMove)
      unsubscribe()
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null
  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <CustomMeshPreview node={previewNode} />
    </group>
  )
}

export default CustomMeshTool
