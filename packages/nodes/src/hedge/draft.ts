'use client'

import type { AnyNodeId, SceneApi } from '@pascal-app/core'
import {
  isAngleSnapActive,
  isGridSnapActive,
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  useInteractionScope,
  visibleScene,
} from '@pascal-app/editor'
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { placeHedge } from './placement'

type Point = [number, number]
type Draft = { points: Point[]; hover: Point | null; error: string | null }

/** A click this close to the last point ends the line there instead of adding a point. */
const FINISH_RADIUS_M = 0.15
const MAX_POINTS = 64

export const useHedgeDraft = create<Draft>(() => ({ points: [], hover: null, error: null }))
let owners = 0
const resetDraft = () => useHedgeDraft.setState({ points: [], hover: null, error: null })

/** Both views snap in Site metres; Alt keeps the raw cursor. */
export function snapHedgeDraftPoint(point: Point, force = false): Point {
  if (force) return point
  const last = useHedgeDraft.getState().points.at(-1)
  if (last && isAngleSnapActive()) {
    const [dx, dz] = [point[0] - last[0], point[1] - last[1]]
    const angle = Math.round(Math.atan2(dz, dx) / (Math.PI / 12)) * (Math.PI / 12)
    const length = Math.hypot(dx, dz)
    return [last[0] + Math.cos(angle) * length, last[1] + Math.sin(angle) * length]
  }
  const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

/**
 * The hedge being drawn, shared by the 3D tool and the plan tool: each click adds a point of its
 * line, in Site metres; a click on the last point, or Enter, plants it through the operation the
 * agents call; Backspace takes the last point back and Escape leaves the tool.
 */
export function useHedgeDraftController({
  sceneApi,
  selectNode,
  finishTool,
  siteId,
  view,
}: {
  sceneApi: SceneApi
  selectNode: (id: AnyNodeId) => void
  finishTool: () => void
  siteId?: string
  view: '2d' | '3d'
}) {
  const draft = useHedgeDraft()
  const plant = useCallback(() => {
    const { points } = useHedgeDraft.getState()
    if (points.length < 2) {
      useHedgeDraft.setState({ error: 'Add at least two points.' })
      return
    }
    if (
      placeHedge(sceneApi, points, selectNode, siteId, (error) => useHedgeDraft.setState({ error }))
    ) {
      resetDraft()
      finishTool()
    }
  }, [sceneApi, selectNode, siteId, finishTool])
  const addPoint = useCallback(
    (point: Point) => {
      const { points } = useHedgeDraft.getState()
      const last = points.at(-1)
      const onLast = last && Math.hypot(point[0] - last[0], point[1] - last[1]) < FINISH_RADIUS_M
      if (onLast || points.length >= MAX_POINTS) return plant()
      useHedgeDraft.setState({ points: [...points, point], hover: point, error: null })
    },
    [plant],
  )
  useEffect(() => {
    if (owners++ === 0) useInteractionScope.getState().begin({ kind: 'drafting', tool: 'hedge' })
    return () => {
      if (--owners === 0) {
        resetDraft()
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'hedge')
      }
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        isTypingTarget(event.target) ||
        (visibleScene(useEditor.getState()) === '2d' ? '2d' : '3d') !== view
      )
        return
      if (!['Escape', 'Enter', 'Backspace'].includes(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Enter') return plant()
      if (event.key === 'Backspace')
        return useHedgeDraft.setState((state) => ({
          points: state.points.slice(0, -1),
          error: null,
        }))
      markToolCancelConsumed()
      resetDraft()
      finishTool()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view, finishTool, plant])
  const line = draft.hover && draft.points.length ? [...draft.points, draft.hover] : draft.points
  return { addPoint, line, error: draft.error }
}
