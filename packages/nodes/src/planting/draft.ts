'use client'

import { type AnyNodeId, PLANTING_LIMITS, type SceneApi } from '@pascal-app/core'
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
import { placePlanting } from './placement'

type Point = [number, number]
type Draft = { points: Point[]; hover: Point | null; error: string | null }
export const usePlantingDraft = create<Draft>(() => ({ points: [], hover: null, error: null }))
let owners = 0
const reset = () => usePlantingDraft.setState({ points: [], hover: null, error: null })
const FINISH_RADIUS_M = 0.15

/** Both views quantise the same Site-space proposal; Alt always keeps the raw cursor. */
export function snapPlantingDraftPoint(point: Point, force = false): Point {
  if (force) return point
  const last = usePlantingDraft.getState().points.at(-1)
  if (last && isAngleSnapActive()) {
    const [dx, dz] = [point[0] - last[0], point[1] - last[1]]
    const angle = Math.round(Math.atan2(dz, dx) / (Math.PI / 12)) * (Math.PI / 12)
    const length = Math.hypot(dx, dz)
    return [last[0] + Math.cos(angle) * length, last[1] + Math.sin(angle) * length]
  }
  const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
  return step > 0 ? [Math.round(point[0] / step) * step, Math.round(point[1] / step) * step] : point
}

/** One outline shared by the two tools; only a successful operation consumes it. */
export function usePlantingDraftController({
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
  const draft = usePlantingDraft()
  const plant = useCallback(() => {
    const { points } = usePlantingDraft.getState()
    if (points.length < PLANTING_LIMITS.minPoints) {
      usePlantingDraft.setState({ error: 'Add at least three outline points.' })
      return
    }
    const id = placePlanting(sceneApi, points, selectNode, siteId, (error) =>
      usePlantingDraft.setState({ error }),
    )
    if (id) {
      reset()
      finishTool()
    }
  }, [sceneApi, selectNode, siteId, finishTool])
  const addPoint = useCallback(
    (point: Point) => {
      const { points } = usePlantingDraft.getState()
      const first = points[0]
      if (
        first &&
        points.length >= 3 &&
        Math.hypot(point[0] - first[0], point[1] - first[1]) < FINISH_RADIUS_M
      )
        return plant()
      const last = points.at(-1)
      if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.01) return
      if (points.length >= PLANTING_LIMITS.maxPoints) {
        usePlantingDraft.setState({
          error: 'The outline has 64 points. Press Enter to plant it, or Backspace to revise it.',
        })
        return
      }
      usePlantingDraft.setState({ points: [...points, point], hover: point, error: null })
    },
    [plant],
  )
  useEffect(() => {
    if (owners++ === 0) useInteractionScope.getState().begin({ kind: 'drafting', tool: 'planting' })
    return () => {
      if (--owners === 0) {
        reset()
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'planting')
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
      if (!['Enter', 'Backspace', 'Escape'].includes(event.key)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Enter') return plant()
      if (event.key === 'Backspace') {
        usePlantingDraft.setState((state) => ({ points: state.points.slice(0, -1), error: null }))
        return
      }
      markToolCancelConsumed()
      reset()
      finishTool()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view, plant, finishTool])
  const line = draft.hover && draft.points.length ? [...draft.points, draft.hover] : draft.points
  return { addPoint, line, error: draft.error }
}
