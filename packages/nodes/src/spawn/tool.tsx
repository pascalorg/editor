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
  getFloorStackPreviewPosition,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  movementSfxStepKey,
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  usePlacementPreview,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import {
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
} from '../shared/floor-placement'
import { SpawnPreview } from './renderer'

const ROTATION_STEP = Math.PI / 4

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
 * shows the real spawn model as a translucent placement ghost, and supports
 * R/T yaw before commit. Snapping is mode-driven (grid + Figma-style
 * alignment "lines"), matching the shelf / column build tools.
 */
const SpawnTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<string | null>(null)
  const rotationRef = useRef(0)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)

  // Default spawn for the footprint anchors the alignment solver reads.
  const previewNode = useMemo(
    () => SpawnNode.parse({ name: 'Spawn Point', position: [0, 0, 0], rotation: 0 }),
    [],
  )

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    rotationRef.current = 0
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
        rotation: rotationRef.current,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visualPosition)
      lastCursorRef.current = position
      usePlacementPreview.getState().set({
        ...previewNode,
        position,
        rotation: rotationRef.current,
      })

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
          rotation: rotationRef.current,
        })
        useScene.getState().updateNode(existingSpawnId, {
          parentId: activeLevelId,
          position: next,
          rotation: rotationRef.current,
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
          rotation: rotationRef.current,
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
      usePlacementPreview.getState().clear()
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return
      }
      let delta = 0
      if (event.key === 'r' || event.key === 'R') delta = ROTATION_STEP
      else if (event.key === 't' || event.key === 'T') delta = -ROTATION_STEP
      else return

      event.preventDefault()
      event.stopPropagation()
      rotationRef.current += delta
      if (cursorRef.current) cursorRef.current.rotation.y = rotationRef.current
      if (lastCursorRef.current) {
        usePlacementPreview.getState().set({
          ...previewNode,
          position: lastCursorRef.current,
          rotation: rotationRef.current,
        })
      }
      triggerSFX('sfx:item-rotate')
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      window.removeEventListener('keydown', onKeyDown, true)
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <SpawnPreview node={previewNode} />
    </group>
  )
}

export default SpawnTool
