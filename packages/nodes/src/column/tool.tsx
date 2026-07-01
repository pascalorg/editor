'use client'

import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnPresetId,
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
  triggerSFX,
  useAlignmentGuides,
  useEditor,
  useFacingPose,
  usePlacementPreview,
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
import { ColumnPreview } from './renderer'

const DEFAULT_COLUMN_PRESET_ID = 'basicPillar' satisfies ColumnPresetId

function createColumnFromPreset(presetId: ColumnPresetId, position: [number, number, number]) {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return ColumnNode.parse({
    name: label,
    position,
    rotation: 0,
    ...preset,
  })
}

/**
 * Registry-driven column placement tool. Mirrors the shelf build tool:
 * a translucent `ColumnPreview` ghost follows the cursor (the piece the
 * legacy editor-side `ColumnTool` lacked — it only showed a sphere), grid
 * snap is layered with Figma-style alignment, and a `grid:click` commits.
 *
 * Lives in `packages/nodes` (not the editor) specifically so it can import
 * the column geometry for the ghost — the editor package can't depend on
 * `nodes`. Wired via `def.tool`, so `ToolManager`'s registry-first path
 * mounts it and the legacy `<ColumnTool>` branch no longer fires.
 */
const ColumnTool = () => {
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const cursorRef = useRef<Group>(null)
  const previousSnapRef = useRef<[number, number] | null>(null)
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)

  // Default-preset column for the placement ghost — matches exactly what the
  // commit creates (`basicPillar`), so the preview is faithful.
  const previewNode = useMemo(() => createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [0, 0, 0]), [])

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null
    cursorVisibleRef.current = false
    setCursorVisible(false)
    const lastCursorRef: { current: [number, number, number] | null } = { current: null }

    // Alignment candidates — anchors of every other alignable object, gathered
    // here and refreshed after each placement so a just-placed column becomes a
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
      // Forward-facing floor triangle, drawn by the editor-side overlay. Columns
      // never rotate (`rotation: 0`), so the triangle just sits in front.
      useFacingPose.getState().set({
        position: visualPosition,
        rotationY: previewNode.rotation,
        depth: previewNode.depth,
      })
      lastCursorRef.current = position

      // Publish a transient, positioned preview node for the 2D floor-plan
      // ghost (the 3D `ColumnPreview` mesh is hidden in 2D). The floor-plan
      // placement-preview layer renders this node's footprint at the snapped,
      // aligned cursor so users see the pillar before they click.
      usePlacementPreview.getState().set({ ...previewNode, position })

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

      const column = createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, position)
      useScene.getState().createNode(column, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [column.id] })
      triggerSFX('sfx:structure-build')
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
      if (useEditor.getState().getContinuation('point') === 'repeat') {
        // The placed column is now a valid alignment target for the next one.
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
      } else {
        cursorVisibleRef.current = false
        setCursorVisible(false)
        useFacingPose.getState().clear()
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
      usePlacementPreview.getState().clear()
      useFacingPose.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef} visible={cursorVisible}>
      <ColumnPreview node={previewNode} />
    </group>
  )
}

export default ColumnTool
