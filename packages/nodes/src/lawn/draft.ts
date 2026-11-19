'use client'

import { type AnyNodeId, defaultI18n as i18n, LAWN_LIMITS, type SceneApi } from '@pascal-app/core'
import {
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  useInteractionScope,
  visibleScene,
} from '@pascal-app/editor'
import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import { useLawnAuthoring } from './brush'
import { placeLawn } from './placement'

type Point = [number, number]
type DraftContext = {
  sceneApi: SceneApi
  selectNode: (id: AnyNodeId) => void
  finishTool: () => void
  siteId?: string
  view: '2d' | '3d'
}
export const useLawnDraft = create<{ points: Point[]; hover: Point | null; error: string | null }>(
  () => ({
    points: [],
    hover: null,
    error: null,
  }),
)
const reset = () => useLawnDraft.setState({ points: [], hover: null, error: null })
let owners = 0

function finishLawnDraft({ sceneApi, selectNode, siteId, finishTool }: DraftContext) {
  const { points } = useLawnDraft.getState()
  if (points.length < LAWN_LIMITS.minPoints) {
    useLawnDraft.setState({
      error: i18n._({
        id: 'node.lawn.draft.minPoints',
        message: 'Add at least three outline points.',
      }),
    })
    return
  }
  const id = placeLawn(sceneApi, points, selectNode, siteId, () =>
    useLawnDraft.setState({
      error: i18n._({
        id: 'node.lawn.draft.invalid',
        message: 'This lawn cannot be placed here. Check the outline, area and available ground.',
      }),
    }),
  )
  if (id) {
    reset()
    finishTool()
  }
}

function addLawnDraftPoint(point: Point, mode: 'area' | 'brush', finish: () => void) {
  if (
    mode !== 'area' ||
    point.some((n) => !Number.isFinite(n) || Math.abs(n) > LAWN_LIMITS.maxCoordinate)
  )
    return
  const { points } = useLawnDraft.getState()
  const first = points[0],
    last = points.at(-1)
  if (first && points.length >= 3 && Math.hypot(point[0] - first[0], point[1] - first[1]) < 0.15)
    return finish()
  if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < 0.01) return
  if (points.length >= LAWN_LIMITS.maxPoints) {
    useLawnDraft.setState({
      error: i18n._({
        id: 'node.lawn.draft.maxPoints',
        message: 'The outline is full. Press Enter to finish, or Backspace to revise it.',
      }),
    })
    return
  }
  useLawnDraft.setState({ points: [...points, [...point]], hover: point, error: null })
}

function claimLawnDraft() {
  if (owners++ === 0) useInteractionScope.getState().begin({ kind: 'drafting', tool: 'lawn' })
  return () => {
    if (--owners === 0) {
      reset()
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'lawn')
    }
  }
}

function installDraftKeys(view: DraftContext['view'], finish: () => void, finishTool: () => void) {
  const key = (event: KeyboardEvent) => {
    if (
      isTypingTarget(event.target) ||
      (visibleScene(useEditor.getState()) === '2d' ? '2d' : '3d') !== view
    )
      return
    if (!['Enter', 'Backspace', 'Escape'].includes(event.key)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Enter') return finish()
    if (event.key === 'Backspace') {
      useLawnDraft.setState((state) => ({ points: state.points.slice(0, -1), error: null }))
      return
    }
    markToolCancelConsumed()
    reset()
    finishTool()
  }
  window.addEventListener('keydown', key, true)
  return () => window.removeEventListener('keydown', key, true)
}

export function useLawnDraftController(context: DraftContext) {
  const { sceneApi, selectNode, finishTool, siteId, view } = context
  const draft = useLawnDraft()
  const mode = useLawnAuthoring((state) => state.mode)
  const finish = useCallback(
    () => finishLawnDraft({ sceneApi, selectNode, finishTool, siteId, view }),
    [sceneApi, selectNode, siteId, finishTool, view],
  )
  const addPoint = useCallback(
    (point: Point) => addLawnDraftPoint(point, mode, finish),
    [finish, mode],
  )
  useEffect(() => {
    if (mode === 'area') return claimLawnDraft()
  }, [mode])
  useEffect(() => {
    if (mode === 'area') return installDraftKeys(view, finish, finishTool)
  }, [mode, view, finish, finishTool])
  // The hint card lists the finishing key only once there is something to finish (as the slab's).
  const placed = mode === 'area' ? draft.points.length : 0
  useEffect(() => {
    useEditor.getState().setDraftVertexCount(placed)
  }, [placed])
  useEffect(() => () => useEditor.getState().setDraftVertexCount(0), [])
  // A double-click finishes like Enter, once there is an outline to lay (as the slab's does).
  const finishIfReady = useCallback(() => {
    if (mode === 'area' && useLawnDraft.getState().points.length >= 3) finish()
  }, [finish, mode])
  const line = draft.hover && draft.points.length ? [...draft.points, draft.hover] : draft.points
  return { addPoint, finish: finishIfReady, line, error: draft.error }
}
