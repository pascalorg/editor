'use client'
import {
  emitter,
  resolveTerrainWallConstructionOptions,
  useScene,
  type WallPlanPoint,
} from '@pascal-app/core'
import {
  type FloorplanToolContext,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
  useFloorplanDraftPreview,
  useFloorplanRender,
  useInteractionScope,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { useWallDrawingMode, useWallDrawingModeKeys } from './drawing-mode'
import { createWallRectangle } from './rectangle-command'

/** The wall's plan tool: line drafting stays with the panel; rectangle mode mounts its own tool. */
export default function WallFloorplanTool(props: FloorplanToolContext) {
  useWallDrawingModeKeys()
  const mode = useWallDrawingMode((s) => s.mode)
  return mode === 'rectangle' ? <RectangleFloorplanTool {...props} /> : null
}

/**
 * Rectangle mode in the floor plan. Pointer moves stay with the panel, so the
 * cursor, snapping, alignment guides and snap beacon are the line wall's own;
 * this tool only claims clicks and publishes the first corner, and the panel's
 * linear draft layer draws the four draft walls from it.
 */
function RectangleFloorplanTool({ activeLevelId }: FloorplanToolContext) {
  const group = useRef<SVGGElement>(null)
  const renderContext = useFloorplanRender()
  const [error, setError] = useState<{ message: string; at: WallPlanPoint } | null>(null)
  useEffect(() => {
    const svg = group.current?.ownerSVGElement
    if (!svg || !activeLevelId) return
    const draft = useFloorplanDraftPreview.getState
    let down: [number, number] | null = null
    let construction: ReturnType<typeof resolveTerrainWallConstructionOptions> | undefined
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall' })
    const claim = (e: Event) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      claim(e)
      down = [e.clientX, e.clientY]
    }
    const cancel = () => {
      if (draft().wallRectangleDraftStart) markToolCancelConsumed()
      draft().setWallRectangleDraftStart(null)
      down = null
      setError(null)
    }
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      claim(e)
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) {
        down = null
        return
      }
      down = null
      // The panel's snapped cursor, exactly where a line wall would land.
      const point = draft().cursorPoint
      if (!point) return
      const start = draft().wallRectangleDraftStart
      if (!start) {
        construction = resolveTerrainWallConstructionOptions(
          useScene.getState().nodes,
          activeLevelId,
          point,
          useEditor.getState().toolDefaults.wall,
        )
        draft().setWallRectangleDraftStart(point)
        setError(null)
        return
      }
      try {
        createWallRectangle(
          activeLevelId,
          start,
          point,
          useEditor.getState().toolDefaults.wall ?? {},
          construction,
        )
        cancel()
        triggerSFX('sfx:structure-build')
      } catch (e) {
        setError({ message: (e as Error).message, at: point })
      }
    }
    const stopDouble = (e: MouseEvent) => {
      if (e.button === 0) claim(e)
    }
    svg.addEventListener('pointerdown', onDown, true)
    svg.addEventListener('click', onClick, true)
    svg.addEventListener('dblclick', stopDouble, true)
    emitter.on('tool:cancel', cancel)
    return () => {
      svg.removeEventListener('pointerdown', onDown, true)
      svg.removeEventListener('click', onClick, true)
      svg.removeEventListener('dblclick', stopDouble, true)
      emitter.off('tool:cancel', cancel)
      draft().setWallRectangleDraftStart(null)
      useInteractionScope.getState().endIf((s) => s.kind === 'drafting' && s.tool === 'wall')
    }
  }, [activeLevelId])
  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  return (
    <g ref={group} pointerEvents="none">
      {error && (
        <text x={error.at[0]} y={error.at[1] - 0.2} fill="#ef4444" fontSize={12 * unitsPerPixel}>
          {error.message}
        </text>
      )}
    </g>
  )
}
