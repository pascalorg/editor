'use client'

import type { AnyNodeId, SceneApi, TerrainBreakNode } from '@pascal-app/core'
import {
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  useInteractionScope,
  visibleScene,
} from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { rampSiteFrame } from '../ramp/edit'
import { commitTerrainBreakCreation, terrainBreakLotLine } from './edit'
import { TerrainBreakOptions } from './options'

type Point = [number, number]
type Options = Pick<TerrainBreakNode, 'kind' | 'left' | 'right'>
type Draft = {
  start: Point | null
  hover: Point | null
  options: Options
  error: string | null
}
export const useTerrainBreakDraft = create<Draft>(() => ({
  start: null,
  hover: null,
  options: { kind: 'cliff', left: 1, right: 'ground' },
  error: null,
}))
let owners = 0
const resetDraft = () => useTerrainBreakDraft.setState({ start: null, hover: null, error: null })

export function useTerrainBreakDraftController({
  sceneApi,
  activeLevelId,
  selectNode,
  finishTool,
  view,
}: {
  sceneApi: SceneApi
  activeLevelId: AnyNodeId | null
  selectNode: (id: AnyNodeId) => void
  finishTool: () => void
  view: '2d' | '3d'
}) {
  const draft = useTerrainBreakDraft()
  const frame = rampSiteFrame(sceneApi, activeLevelId)
  const addPoint = useCallback(
    (point: Point) => {
      const current = useTerrainBreakDraft.getState()
      if (!current.start) {
        useTerrainBreakDraft.setState({ start: point, hover: point, error: null })
        return
      }
      try {
        const resolved = rampSiteFrame(sceneApi, activeLevelId)
        if (!resolved) throw new Error('Choose a Site before drawing a terrain break.')
        const line = terrainBreakLotLine(resolved.site, current.start, point)
        const id = commitTerrainBreakCreation(sceneApi, { ...current.options, line })
        resetDraft()
        selectNode(id)
        finishTool()
      } catch (error) {
        useTerrainBreakDraft.setState({
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [sceneApi, activeLevelId, selectNode, finishTool],
  )
  useEffect(() => {
    if (owners++ === 0)
      useInteractionScope.getState().begin({ kind: 'drafting', tool: 'terrain-break' })
    return () => {
      if (--owners === 0) {
        resetDraft()
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'terrain-break')
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
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        markToolCancelConsumed()
        resetDraft()
        finishTool()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [view, finishTool])
  let line: Point[] = draft.start && draft.hover ? [draft.start, draft.hover] : []
  if (frame && draft.start && draft.hover) {
    try {
      line = terrainBreakLotLine(frame.site, draft.start, draft.hover)
    } catch {}
  }
  return { draft, frame, addPoint, line }
}

export function TerrainBreakDraftControls({ view }: { view: '2d' | '3d' }) {
  const primary = useEditor((state) => (visibleScene(state) === '2d' ? '2d' : '3d'))
  const draft = useTerrainBreakDraft()
  if (primary !== view || typeof document === 'undefined') return null
  const setOptions = (patch: Partial<Options>) =>
    useTerrainBreakDraft.setState((state) => ({ options: { ...state.options, ...patch } }))
  const controls = (
    <div className="pointer-events-auto fixed bottom-20 left-4 z-50 w-64 space-y-2 rounded-xl border border-border bg-sidebar/95 p-3 text-foreground shadow-xl">
      <p className="text-sm font-medium">Draw terrain break</p>
      <p className="text-xs text-muted-foreground">
        Click two points to set the direction. The straight boundary extends across the lot. Left
        and right follow that direction.
      </p>
      <TerrainBreakOptions onChange={setOptions} value={draft.options} />
      <p className="text-xs text-muted-foreground">Elevations are absolute Site metres.</p>
      {draft.error && (
        <p className="text-xs text-red-500" role="alert">
          {draft.error}
        </p>
      )}
    </div>
  )
  return view === '3d' ? (
    <Html
      calculatePosition={(_object, _camera, size) => [size.width / 2, size.height / 2]}
      fullscreen
      style={{ pointerEvents: 'none' }}
      zIndexRange={[80, 0]}
    >
      {controls}
    </Html>
  ) : (
    createPortal(controls, document.body)
  )
}
