'use client'

import {
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  resolveSupportSlabPatch,
  SpawnNode,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
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
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import {
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
} from '../shared/floor-placement'

function getExistingSpawnIds() {
  const nodes = useScene.getState().nodes
  return Object.values(nodes)
    .filter((node) => node.type === 'spawn')
    .map((node) => node.id)
    .sort()
}

/**
 * Registry-driven spawn placement tool. Reads `activeLevelId` from useViewer
 * directly (no props), broadcasts placement via store updates + SFX, and
 * uses the shared CursorSphere from @pascal-app/editor for visual parity
 * with legacy placement tools. Snapping is mode-driven (grid + Figma-style
 * alignment "lines"), matching the shelf / column build tools.
 */
const SpawnTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<string | null>(null)

  // Default spawn for the footprint anchors the alignment solver reads.
  const previewNode = useMemo(
    () => SpawnNode.parse({ name: 'Spawn Point', position: [0, 0, 0], rotation: 0 }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    const lastCursorRef: { current: [number, number, number] | null } = { current: null }
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)

    const onGridMove = (event: GridEvent) => {
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
        rotation: 0,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visualPosition)
      lastCursorRef.current = position

      const nextSnapKey = movementSfxStepKey({
        coords: [position[0], position[2]],
        gridSnapActive: isGridSnapActive(),
        gridStep: useEditor.getState().gridSnapStep,
      })
      const prev = previousSnapRef.current
      if (prev !== nextSnapKey) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = nextSnapKey
      }
    }

    const onGridClick = (event: GridEvent) => {
      const next =
        lastCursorRef.current ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const [existingSpawnId, ...duplicates] = getExistingSpawnIds()
      let placedId: SpawnNode['id']

      if (existingSpawnId) {
        const live = useScene.getState().nodes[existingSpawnId]
        const effectiveSpawn = SpawnNode.parse({
          ...live,
          parentId: activeLevelId,
          position: next,
          rotation: 0,
        })
        useScene.getState().updateNode(existingSpawnId, {
          parentId: activeLevelId,
          position: next,
          rotation: 0,
          ...resolveSupportSlabPatch(effectiveSpawn, useScene.getState().nodes),
        })
        if (duplicates.length > 0) {
          useScene.getState().deleteNodes(duplicates)
        }
        placedId = existingSpawnId
      } else {
        const spawn = SpawnNode.parse({
          name: 'Spawn Point',
          position: next,
          rotation: 0,
          parentId: activeLevelId,
        })
        const committedSpawn = SpawnNode.parse({
          ...spawn,
          ...resolveSupportSlabPatch(spawn, useScene.getState().nodes),
        })
        useScene.getState().createNode(committedSpawn, activeLevelId)
        placedId = committedSpawn.id
      }

      useViewer.getState().setSelection({ selectedIds: [placedId] })
      triggerSFX('sfx:structure-build')
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
      useAlignmentGuides.getState().clear()
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      useAlignmentGuides.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return <CursorSphere color="#818cf8" height={2.2} ref={cursorRef} />
}

export default SpawnTool
