'use client'

import {
  type AnyNodeId,
  emitter,
  type GridEvent,
  type LevelNode,
  RoofType as RoofTypeSchema,
} from '@pascal-app/core'
import {
  clearSurfacePlanSnapFeedback,
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  useFloorplanDraftPreview,
  visibleScene,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { createConicalRoofSectorAboveWall } from './conical-roof'
import {
  parseRoofFootprintSource,
  pickConicalRoofWall,
  pickRoofRoom,
  roofFootprintPreviewIds,
} from './roof-footprint'
import useRoofFootprintSource from './roof-footprint-source'
import useRoofPlacementMode from './roof-placement-mode'
import useRoofRidgeMode, { ridgeQuarterTurn } from './roof-ridge-mode'
import {
  collectRoofAlignmentAnchors,
  commitRoofFootprint,
  commitRoofPlacement,
  resolveRoofDraftPoint,
} from './tool'

/**
 * The roof tool in 2D-only view. The 3D `RoofTool` lives in the canvas, which never renders while
 * its pane is hidden, so in 2D-only view this commits instead, from the plan's own grid events: it
 * snaps the corners, writes them into the plan's draft rectangle (or hovers the room, or for a cone
 * the curved wall) and writes the roof. Split and 3D views keep the 3D tool as the one owner.
 */
export default function RoofFloorplanTool({
  activeLevelId,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const planOwnsInput = useEditor((state) => visibleScene(state) === '2d')
  const levelId = planOwnsInput ? (activeLevelId as LevelNode['id'] | null) : null
  const roofType = useEditor((state) => {
    const parsed = RoofTypeSchema.safeParse(state.toolDefaults.roof?.roofType)
    return parsed.success ? parsed.data : 'gable'
  })
  // A new source or roof type starts over, as the 3D tool does: a first corner kept across it
  // would end the next rectangle with no draft on the plan to show it.
  const source = useRoofFootprintSource((state) => parseRoofFootprintSource(state.source, roofType))

  useEffect(() => {
    if (!levelId) return
    let corner1: [number, number, number] | null = null
    const draft = useFloorplanDraftPreview.getState
    // A rectangle the 3D tool opened before the view changed has no first corner here: drop it, or
    // the plan's draft and this tool's corner fall out of step (each click starts one, ends the other).
    const clearDraft = () => {
      draft().setRoofDraftStart(null)
      draft().setRoofDraftEnd(null)
      draft().setRoofDraftQuarterTurn(false)
    }
    clearDraft()
    // Snapped as the 3D tool snaps in split view (onto the walls below too), so the same clicks
    // make the same roof in either view.
    let alignmentCandidates = collectRoofAlignmentAnchors(sceneApi.nodes(), levelId, roofType)
    const planPoint = (event: GridEvent) =>
      resolveRoofDraftPoint(event, levelId, sceneApi.nodes(), roofType, alignmentCandidates)
    let previewedId: string | null = null
    const preview = (target: { id: string; ids: string[] } | null) => {
      if ((target?.id ?? null) === previewedId) return
      previewedId = target?.id ?? null
      useViewer.getState().setPreviewSelectedIds(target?.ids ?? [])
    }
    const conicalWall = (event: GridEvent) =>
      pickConicalRoofWall(levelId, sceneApi.nodes(), [
        event.localPosition[0],
        event.localPosition[2],
      ])

    const onMove = (event: GridEvent) => {
      if (source === 'walls') {
        const wall = conicalWall(event)
        preview(wall && { id: wall.id, ids: [wall.id] })
        return
      }
      if (source === 'room') {
        const room = pickRoofRoom(levelId, sceneApi.nodes(), planPoint(event))
        useRoofFootprintSource.getState().setRoomPick(room.pick)
        preview(room.target && { id: room.target.id, ids: roofFootprintPreviewIds(room.target) })
        return
      }
      const [x, z] = planPoint(event)
      if (!corner1) return
      draft().setRoofDraftEnd([x, z])
      draft().setRoofDraftQuarterTurn(
        ridgeQuarterTurn(
          Math.abs(x - corner1[0]),
          Math.abs(z - corner1[2]),
          useRoofRidgeMode.getState().mode,
        ),
      )
    }

    const onClick = (event: GridEvent) => {
      if (source === 'walls') {
        const wall = conicalWall(event)
        if (!wall) return
        preview(null)
        const segmentId = createConicalRoofSectorAboveWall(
          wall,
          sceneApi.nodes(),
          sceneApi,
          levelId,
        )
        if (segmentId) selectNode(segmentId)
        return
      }
      if (source === 'room') {
        const { target, pick } = pickRoofRoom(levelId, sceneApi.nodes(), planPoint(event))
        useRoofFootprintSource.getState().setRoomPick(pick)
        if (!target) return
        const roofId = commitRoofFootprint(
          sceneApi,
          levelId,
          target,
          useRoofRidgeMode.getState().mode,
        )
        if (roofId) selectNode(roofId as AnyNodeId)
        return
      }
      const [x, z] = planPoint(event)
      const corner: [number, number, number] = [x, event.localPosition[1], z]
      if (!corner1) {
        corner1 = corner
        draft().setRoofDraftStart([x, z])
        draft().setRoofDraftEnd([x, z])
        triggerSFX('sfx:structure-build-start')
        return
      }
      const roofId = commitRoofPlacement(
        sceneApi,
        levelId,
        corner1,
        corner,
        useViewer.getState().selection.selectedIds,
        useRoofRidgeMode.getState().mode,
        useRoofPlacementMode.getState().mode,
      )
      corner1 = null
      clearDraft()
      alignmentCandidates = collectRoofAlignmentAnchors(sceneApi.nodes(), levelId, roofType)
      clearSurfacePlanSnapFeedback()
      if (roofId) selectNode(roofId as AnyNodeId)
    }

    const onCancel = () => {
      if (!corner1) return
      markToolCancelConsumed()
      corner1 = null
      clearDraft()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      )
        return
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      // As in 3D: P cycles a cone's placement surface, R turns a drawn roof's ridge.
      if (source === 'walls') {
        if (key !== 'p') return
        event.preventDefault()
        useRoofPlacementMode.getState().cycleMode()
        triggerSFX('sfx:grid-snap')
        return
      }
      if (key !== 'r') return
      event.preventDefault()
      useRoofRidgeMode.getState().toggle()
      triggerSFX('sfx:item-rotate')
    }
    // The HUD chip flips the ridge too; the draft's ridge line follows either way.
    const unsubscribeRidgeMode = useRoofRidgeMode.subscribe(() => {
      const start = draft().roofDraftStart
      const end = draft().roofDraftEnd
      if (!(corner1 && start && end)) return
      draft().setRoofDraftQuarterTurn(
        ridgeQuarterTurn(
          Math.abs(end[0] - start[0]),
          Math.abs(end[1] - start[1]),
          useRoofRidgeMode.getState().mode,
        ),
      )
    })

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('keydown', onKeyDown)
      unsubscribeRidgeMode()
      useRoofFootprintSource.getState().setRoomPick(null)
      preview(null)
      clearDraft()
      clearSurfacePlanSnapFeedback()
    }
  }, [levelId, roofType, sceneApi, selectNode, source])

  return null
}
