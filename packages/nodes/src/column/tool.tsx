'use client'

import {
  COLUMN_PRESETS,
  ColumnNode,
  type ColumnPresetId,
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  resolveSupportSlabPatch,
  useScene,
} from '@pascal-app/core'
import {
  clearToolDefaultsOnDeactivate,
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
import { publishCadBeacon } from '../shared/cad-placement-beacon'
import {
  type FloorPlacementClickTriggerEvent,
  getLevelLocalSnappedPosition,
  resolveAlignedFloorPlacement,
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import {
  collectStructuralGridAxes,
  resolveStructuralGridSnap,
} from '../structural-grid/coordination'
import { ColumnPreview } from './renderer'

const DEFAULT_COLUMN_PRESET_ID = 'basicPillar' satisfies ColumnPresetId

/**
 * `defaults` carries the shape the user last worked a column into (via
 * `toolDefaults.column`, seeded from the sticky memory on tool activation)
 * or a staged preset's parameters. It is applied over the base preset so a
 * plain shaft stays plain across placements.
 */
function createColumnFromPreset(
  presetId: ColumnPresetId,
  position: [number, number, number],
  defaults: Readonly<Record<string, unknown>> = {},
) {
  const { label, ...preset } = COLUMN_PRESETS[presetId]
  return ColumnNode.parse({
    name: label,
    position,
    rotation: 0,
    ...preset,
    ...defaults,
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
  const cursorVisibleRef = useRef(false)
  const [cursorVisible, setCursorVisible] = useState(false)

  // Default-preset column for the placement ghost — matches exactly what the
  // commit creates (`basicPillar` under the active tool defaults), so the
  // preview is faithful right down to the remembered shaft profile.
  const columnDefaults = useEditor((state) => state.toolDefaults.column)
  const previewNode = useMemo(
    () => createColumnFromPreset(DEFAULT_COLUMN_PRESET_ID, [0, 0, 0], columnDefaults),
    [columnDefaults],
  )

  // Drop the staged entry on deactivation, like every other drawn kind, so a
  // preset placed once doesn't outlive its activation. `setTool` re-seeds
  // from the sticky memory next time the tool is picked. Unmount-only.
  useEffect(() => () => clearToolDefaultsOnDeactivate('column'), [])

  useEffect(() => {
    if (!activeLevelId) return
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

      const {
        position: alignedPosition,
        guides,
        cadSnap,
      } = resolveAlignedFloorPlacement({
        node: previewNode,
        rawX: event.localPosition[0],
        rawZ: event.localPosition[2],
        gridStep: useEditor.getState().gridSnapStep,
        candidates: alignmentCandidates,
        showAlignment: isAlignmentGuideActive(),
        applyAlignmentSnap: isMagneticSnapActive(),
        bypassGrid: !isGridSnapActive(),
        cadLevelId: activeLevelId ?? null,
      })
      const structuralSnap =
        isGridSnapActive() || isMagneticSnapActive()
          ? resolveStructuralGridSnap(
              [alignedPosition[0], alignedPosition[2]],
              collectStructuralGridAxes(useScene.getState().nodes, activeLevelId),
            )
          : null
      const position: [number, number, number] = structuralSnap
        ? [structuralSnap.point[0], alignedPosition[1], structuralSnap.point[1]]
        : alignedPosition
      if (structuralSnap) useAlignmentGuides.getState().clear()
      else useAlignmentGuides.getState().set(guides)

      // Placement never showed a beacon before; a CAD snap silently moving the
      // ghost would read as a bug, so it gets the marker the drafting tools
      // show. Published after the structural-grid pass, which can override the
      // position — a beacon left standing where the node no longer is would be
      // worse than none.
      publishCadBeacon(structuralSnap ? null : cadSnap)

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
    }

    const commitAtCursor = (event: FloorPlacementClickTriggerEvent) => {
      const fallbackPosition =
        lastCursorRef.current ??
        getLevelLocalSnappedPosition(
          activeLevelId,
          event,
          useEditor.getState().gridSnapStep,
          !isGridSnapActive(),
        )
      const structuralSnap =
        isGridSnapActive() || isMagneticSnapActive()
          ? resolveStructuralGridSnap(
              [fallbackPosition[0], fallbackPosition[2]],
              collectStructuralGridAxes(useScene.getState().nodes, activeLevelId),
            )
          : null
      const position: [number, number, number] = structuralSnap
        ? [structuralSnap.point[0], fallbackPosition[1], structuralSnap.point[1]]
        : fallbackPosition

      const column = ColumnNode.parse({
        ...createColumnFromPreset(
          DEFAULT_COLUMN_PRESET_ID,
          position,
          useEditor.getState().toolDefaults.column,
        ),
        parentId: activeLevelId,
      })
      const committedColumn = ColumnNode.parse({
        ...column,
        ...resolveSupportSlabPatch(column, useScene.getState().nodes),
      })
      useScene.getState().createNode(committedColumn, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [committedColumn.id] })
      triggerSFX('sfx:structure-build')
      useAlignmentGuides.getState().clear()
      publishCadBeacon(null)
      usePlacementPreview.getState().clear()
      if (useEditor.getState().getContinuation('point') === 'repeat') {
        // The placed column is now a valid alignment target for the next one.
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, previewNode.id)
      } else {
        cursorVisibleRef.current = false
        setCursorVisible(false)
        useFacingPose.getState().clear()
        // Restore select mode with the tool — `mode: 'build'` with no tool is
        // a dead state where the selection manager ignores every click.
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
      stopPlacementCommitPropagation(event)
    }

    emitter.on('grid:move', onGridMove)
    const unsubscribePlacementClicks = subscribeFloorPlacementClicks(commitAtCursor)

    return () => {
      emitter.off('grid:move', onGridMove)
      unsubscribePlacementClicks()
      useAlignmentGuides.getState().clear()
      publishCadBeacon(null)
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
