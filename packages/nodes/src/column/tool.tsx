'use client'

import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnPresetId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  movingFootprintAnchors,
  resolveAlignment,
  snapPointToGrid,
  useAlignmentGuides,
  useScene,
} from '@pascal-app/core'
import { getFloorStackPreviewPosition, triggerSFX, usePlacementPreview } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Group } from 'three'
import { ColumnPreview } from './renderer'

const GRID_STEP = 0.5

/** Figma-style alignment-snap threshold (meters), matching the move tools and
 *  the shelf placement tool. */
const ALIGNMENT_THRESHOLD_M = 0.08

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

  // Default-preset column for the placement ghost — matches exactly what the
  // commit creates (`basicPillar`), so the preview is faithful.
  const previewNode = useMemo(() => createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [0, 0, 0]), [])

  useEffect(() => {
    if (!activeLevelId) return
    previousSnapRef.current = null

    // Alignment candidates — anchors of every other alignable object, gathered
    // here and refreshed after each placement so a just-placed column becomes a
    // target for the next one. `previewNode.id` never collides with a scene
    // node, so nothing real is excluded.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)

    const onGridMove = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)

      // Figma-style alignment snap layered on top of grid snap: when the
      // preview column's footprint edge lines up (on X or Z) with another
      // object's edge, snap there and publish a guide. Alt bypasses.
      let ax = sx
      let az = sz
      const bypass = event.nativeEvent?.altKey === true
      if (!bypass && alignmentCandidates.length > 0) {
        const result = resolveAlignment({
          moving: movingFootprintAnchors(previewNode, sx, sz, 0),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          ax += result.snap.dx
          az += result.snap.dz
        }
        useAlignmentGuides.getState().set(result.guides)
      } else {
        useAlignmentGuides.getState().clear()
      }

      const position: [number, number, number] = [ax, 0, az]
      const visualPosition = getFloorStackPreviewPosition({
        node: previewNode,
        position,
        rotation: previewNode.rotation,
        levelId: activeLevelId,
      })
      cursorRef.current?.position.set(...visualPosition)

      // Publish a transient, positioned preview node for the 2D floor-plan
      // ghost (the 3D `ColumnPreview` mesh is hidden in 2D). The floor-plan
      // placement-preview layer renders this node's footprint at the snapped,
      // aligned cursor so users see the pillar before they click.
      usePlacementPreview.getState().set({ ...previewNode, position })

      const prev = previousSnapRef.current
      if (!prev || prev[0] !== ax || prev[1] !== az) {
        triggerSFX('sfx:grid-snap')
        previousSnapRef.current = [ax, az]
      }
    }

    const onGridClick = (event: GridEvent) => {
      const [sx, sz] = snapPointToGrid([event.localPosition[0], event.localPosition[2]], GRID_STEP)
      let ax = sx
      let az = sz
      const bypass = event.nativeEvent?.altKey === true
      if (!bypass && alignmentCandidates.length > 0) {
        const result = resolveAlignment({
          moving: movingFootprintAnchors(previewNode, sx, sz, 0),
          candidates: alignmentCandidates,
          threshold: ALIGNMENT_THRESHOLD_M,
        })
        if (result.snap) {
          ax += result.snap.dx
          az += result.snap.dz
        }
      }

      const column = createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [ax, 0, az])
      useScene.getState().createNode(column, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [column.id] })
      triggerSFX('sfx:structure-build')
      // The placed column is now a valid alignment target for the next one;
      // refresh the candidate pool and drop the guide from this drop. The
      // 2D ghost re-publishes on the next move.
      alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
    }

    emitter.on('grid:move', onGridMove)
    emitter.on('grid:click', onGridClick)

    return () => {
      emitter.off('grid:move', onGridMove)
      emitter.off('grid:click', onGridClick)
      useAlignmentGuides.getState().clear()
      usePlacementPreview.getState().clear()
    }
  }, [activeLevelId, previewNode])

  if (!activeLevelId) return null

  return (
    <group ref={cursorRef}>
      <ColumnPreview node={previewNode} />
    </group>
  )
}

export default ColumnTool
