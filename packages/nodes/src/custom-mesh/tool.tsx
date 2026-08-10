'use client'

import {
  CustomMeshNode,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  useSpatialQuery,
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
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { customMeshBounds, customMeshDefinition } from './definition'
import CustomMeshPreview from './preview'

const CustomMeshTool = () => {
  const { activeLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const { canPlaceOnFloor } = useSpatialQuery()
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<string | null>(null)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)
  const [validPlacement, setValidPlacement] = useState(true)
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
    let alignmentCandidates = collectAlignmentAnchors(sceneApi.nodes(), previewNode.id)
    const { size } = customMeshBounds(previewNode)

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
      const placement = canPlaceOnFloor(activeLevelId, position, size, [0, previewNode.rotation, 0])
      setValidPlacement(placement.valid)

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
      const placement = canPlaceOnFloor(activeLevelId, position, size, [0, node.rotation, 0])
      setValidPlacement(placement.valid)
      if (!placement.valid) {
        stopPlacementCommitPropagation(event)
        return
      }
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id)
      triggerSFX('sfx:structure-build')
      useAlignmentGuides.getState().clear()
      if (useEditor.getState().getContinuation('point') === 'repeat') {
        alignmentCandidates = collectAlignmentAnchors(sceneApi.nodes(), previewNode.id)
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
  }, [activeLevelId, canPlaceOnFloor, previewNode, sceneApi, selectNode])

  if (!activeLevelId) return null
  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <CustomMeshPreview node={previewNode} valid={validPlacement} />
    </group>
  )
}

export default CustomMeshTool
