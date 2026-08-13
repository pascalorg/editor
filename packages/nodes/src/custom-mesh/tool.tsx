'use client'

import {
  CustomMeshNode,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  resolveFrozenFloorPlacementPatch,
  resolveSupportSlabPatch,
  useSpatialQuery,
} from '@pascal-app/core'
import {
  getFloorStackPreviewPosition,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  movementSfxStepKey,
  type PointerSupportSurface,
  resolvePointerSupportSurface,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useInteractionScope,
  useRegistryToolContext,
} from '@pascal-app/editor'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  isForcePlacementEvent,
  resolveAlignedFloorPlacement,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { customMeshBounds, customMeshDefinition } from './definition'
import CustomMeshPreview from './preview'

const CustomMeshTool = () => {
  const { activeLevelId, sceneApi, selectNode } = useRegistryToolContext()
  const { canPlaceOnFloor } = useSpatialQuery()
  const camera = useThree((state) => state.camera)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const cursorRef = useRef<Group>(null)
  const supportSurfaceRef = useRef<PointerSupportSurface | null>(null)
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
    useInteractionScope.getState().begin({
      kind: 'placing',
      node: CustomMeshNode.parse({
        ...previewNode,
        parentId: activeLevelId,
        metadata: { isNew: true },
      }),
      nodeId: previewNode.id,
      nodeType: previewNode.type,
      view: '3d',
      pressDrag: false,
      driver: 'registry-tool',
    })

    const pointedSurfaceFor = (event: GridEvent | FloorPlacementClickTriggerEvent) =>
      typeof HTMLCanvasElement !== 'undefined' &&
      event.nativeEvent?.target instanceof HTMLCanvasElement
        ? resolvePointerSupportSurface(cameraRef.current, event.position)
        : null

    const resolvePlacement = (
      position: [number, number, number],
      surface: PointerSupportSurface | null,
    ) => {
      const draftNode = CustomMeshNode.parse({
        ...customMeshDefinition.defaults(),
        name: 'Custom Mesh',
        parentId: activeLevelId,
        position,
      })
      const nodes = { ...sceneApi.nodes(), [draftNode.id]: draftNode }
      const patch = surface?.sourceNodeId
        ? resolveFrozenFloorPlacementPatch(draftNode, nodes, {
            position,
            rotation: draftNode.rotation,
            elevation: surface.elevation,
            preferredSlabId: surface.supportSlabId,
          })
        : {
            position,
            ...resolveSupportSlabPatch(draftNode, nodes, {
              maxElevation: surface?.elevation,
              pinSupport: true,
            }),
          }
      return { draftNode, patch }
    }

    const onGridMove = (event: GridEvent) => {
      if (!cursorVisibleRef.current) {
        cursorVisibleRef.current = true
        setCursorVisible(true)
      }
      const forcePlacement = isForcePlacementEvent(event)
      const pointed = pointedSurfaceFor(event)
      supportSurfaceRef.current = pointed
      const gridSnapActive = isGridSnapActive()
      const { position, guides } = resolveAlignedFloorPlacement({
        node: previewNode,
        rawX: pointed?.localPoint?.[0] ?? event.localPosition[0],
        rawZ: pointed?.localPoint?.[2] ?? event.localPosition[2],
        gridStep: useEditor.getState().gridSnapStep,
        candidates: alignmentCandidates,
        showAlignment: isAlignmentGuideActive(),
        applyAlignmentSnap: isMagneticSnapActive(),
        bypassGrid: !gridSnapActive,
      })
      useAlignmentGuides.getState().set(guides)
      const { patch } = resolvePlacement(position, pointed)
      const resolvedPosition = patch.position
      const visualPosition = getFloorStackPreviewPosition({
        node: { ...previewNode, ...patch },
        position: resolvedPosition,
        rotation: previewNode.rotation,
        levelId: activeLevelId,
        maxElevation: pointed?.sourceNodeId ? null : pointed?.elevation,
      })
      cursorRef.current?.position.set(...visualPosition)
      lastPosition = resolvedPosition
      const placement = canPlaceOnFloor(activeLevelId, resolvedPosition, size, [
        0,
        previewNode.rotation,
        0,
      ])
      setValidPlacement(forcePlacement || placement.valid)

      const snapKey = movementSfxStepKey({
        coords: [resolvedPosition[0], resolvedPosition[2]],
        gridSnapActive,
        gridStep: useEditor.getState().gridSnapStep,
      })
      if (snapKey !== previousSnapRef.current) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = snapKey
      }
    }

    const commit = (event: FloorPlacementClickTriggerEvent) => {
      const forcePlacement = isForcePlacementEvent(event)
      const pointed = pointedSurfaceFor(event) ?? supportSurfaceRef.current
      supportSurfaceRef.current = pointed
      const fallbackPosition =
        lastPosition ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const position: [number, number, number] = [fallbackPosition[0], 0, fallbackPosition[2]]
      const { draftNode, patch } = resolvePlacement(position, pointed)
      const placement = canPlaceOnFloor(activeLevelId, patch.position, size, [
        0,
        draftNode.rotation,
        0,
      ])
      setValidPlacement(forcePlacement || placement.valid)
      if (!(forcePlacement || placement.valid)) {
        stopPlacementCommitPropagation(event)
        return
      }
      const node = CustomMeshNode.parse({
        ...draftNode,
        ...patch,
      })
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
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'placing' && scope.nodeId === previewNode.id)
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
