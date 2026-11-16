'use client'

import {
  type AnyNodeId,
  RampNode,
  rampDefaultTransitionLength,
  rampStations,
  type SceneApi,
} from '@pascal-app/core'
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
import { type PlanPoint, rampSegmentFrames, rampSegmentThrough } from './centreline'
import { commitRampCreation, rampSiteFrame } from './edit'
import { RampNumberField } from './number-field'

type Options = Pick<RampNode, 'width' | 'startHeight' | 'endHeight' | 'terrainMode' | 'use'>
type Draft = {
  start: PlanPoint | null
  segments: RampNode['segments']
  pendingEnd: PlanPoint | null
  hover: PlanPoint | null
  mode: 'line' | 'arc'
  options: Options
  error: string | null
}
export const useRampDraft = create<Draft>(() => ({
  start: null,
  segments: [],
  pendingEnd: null,
  hover: null,
  mode: 'line',
  error: null,
  options: { width: 3, startHeight: 0, endHeight: -1.5, terrainMode: 'cut-fill', use: 'vehicle' },
}))
let owners = 0
function resetDraft() {
  useRampDraft.setState({ start: null, segments: [], pendingEnd: null, hover: null, error: null })
}

export function rampDraftLastPoint(draft: Draft): PlanPoint | null {
  if (!draft.start) return null
  return (
    rampSegmentFrames({ start: draft.start, segments: draft.segments }).at(-1)?.end ?? draft.start
  )
}

export function rampDraftNode(draft: Draft, siteId: string, includeHover = false): RampNode | null {
  if (!draft.start) return null
  const segments = [...draft.segments]
  const last = rampDraftLastPoint(draft)
  if (!last) return null
  const end = draft.pendingEnd ?? (includeHover ? draft.hover : null)
  if (end && Math.hypot(end[0] - last[0], end[1] - last[1]) > 0.01) {
    segments.push(
      draft.pendingEnd && draft.hover
        ? rampSegmentThrough(last, draft.pendingEnd, draft.hover)
        : { type: 'line', end },
    )
  }
  if (!segments.length) return null
  const node = RampNode.parse({
    ...draft.options,
    id: 'ramp_preview',
    name: 'Ramp',
    parentId: siteId,
    start: draft.start,
    segments,
  })
  const transition = rampDefaultTransitionLength(node)
  return { ...node, startTransition: transition, endTransition: transition }
}

export function useRampDraftController({
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
  const draft = useRampDraft()
  const frame = rampSiteFrame(sceneApi, activeLevelId)
  const addPoint = useCallback((point: PlanPoint) => {
    const current = useRampDraft.getState()
    if (!current.start) {
      useRampDraft.setState({ start: point, hover: point, error: null })
      return
    }
    const last = rampDraftLastPoint(current)
    if (!last) return
    if (current.pendingEnd) {
      try {
        const segment = rampSegmentThrough(last, current.pendingEnd, point)
        useRampDraft.setState({
          segments: [...current.segments, segment],
          pendingEnd: null,
          hover: point,
          error: null,
        })
      } catch (error) {
        useRampDraft.setState({ error: error instanceof Error ? error.message : String(error) })
      }
    } else if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.01) {
      if (current.mode === 'arc')
        useRampDraft.setState({ pendingEnd: point, hover: point, error: null })
      else
        useRampDraft.setState({
          segments: [...current.segments, { type: 'line', end: point }],
          hover: point,
          error: null,
        })
    }
  }, [])
  const finish = useCallback(() => {
    try {
      const current = useRampDraft.getState()
      if (current.pendingEnd) throw new Error('Click a bend point to finish the arc first.')
      const resolved = rampSiteFrame(sceneApi, activeLevelId)
      if (!resolved) throw new Error('Choose a Site before drawing a ramp.')
      const preview = rampDraftNode(current, resolved.site.id)
      if (!preview) throw new Error('Draw at least one centreline segment.')
      const node = RampNode.parse({ ...preview, id: undefined })
      commitRampCreation(sceneApi, node)
      resetDraft()
      selectNode(node.id)
      finishTool()
    } catch (error) {
      useRampDraft.setState({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [activeLevelId, finishTool, sceneApi, selectNode])
  useEffect(() => {
    if (owners++ === 0) useInteractionScope.getState().begin({ kind: 'drafting', tool: 'ramp' })
    return () => {
      if (--owners === 0) {
        resetDraft()
        useInteractionScope
          .getState()
          .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'ramp')
      }
    }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      const primary = visibleScene(useEditor.getState()) === '2d' ? '2d' : '3d'
      if (view !== primary) return
      if (event.key === 'Enter') {
        event.preventDefault()
        finish()
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        const current = useRampDraft.getState()
        if (current.pendingEnd) useRampDraft.setState({ pendingEnd: null })
        else if (current.segments.length)
          useRampDraft.setState({ segments: current.segments.slice(0, -1), error: null })
        else resetDraft()
      }
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
  }, [finish, finishTool, view])
  let preview: RampNode | null = null
  let previewError: string | null = null
  if (frame) {
    try {
      preview = rampDraftNode(draft, frame.site.id, true)
      if (preview) rampStations(preview)
    } catch (error) {
      preview = null
      previewError = error instanceof Error ? error.message : String(error)
    }
  }
  return { draft, frame, addPoint, finish, preview, previewError }
}

export function RampDraftControls({
  view,
  finish,
  previewError,
}: {
  view: '2d' | '3d'
  finish: () => void
  previewError: string | null
}) {
  const primary = useEditor((state) => (visibleScene(state) === '2d' ? '2d' : '3d'))
  const draft = useRampDraft()
  if (primary !== view || typeof document === 'undefined') return null
  const setOptions = (patch: Partial<Options>) =>
    useRampDraft.setState((state) => ({ options: { ...state.options, ...patch } }))
  const controls = (
    <div className="pointer-events-auto fixed bottom-20 left-4 z-50 w-64 space-y-1 rounded-xl border border-border bg-sidebar/95 p-3 text-foreground shadow-xl">
      <p className="text-sm font-medium">Draw ramp centreline</p>
      <p className="text-xs text-muted-foreground">
        {draft.pendingEnd
          ? 'Click sideways to set the arc bend.'
          : 'Click points, then press Enter. Arc: click an endpoint, then its bend.'}
      </p>
      <div className="flex gap-2">
        {(['line', 'arc'] as const).map((mode) => (
          <button
            aria-pressed={draft.mode === mode}
            className="rounded-full border border-border px-3 py-1 text-xs aria-pressed:bg-accent"
            key={mode}
            onClick={() => useRampDraft.setState({ mode, pendingEnd: null })}
            type="button"
          >
            {mode === 'line' ? 'Line' : 'Arc'}
          </button>
        ))}
      </div>
      <RampNumberField
        label="Width"
        min={0}
        onCommit={(width) => setOptions({ width })}
        value={draft.options.width}
      />
      <RampNumberField
        label="Start height"
        onCommit={(startHeight) => setOptions({ startHeight })}
        value={draft.options.startHeight}
      />
      <RampNumberField
        label="End height"
        onCommit={(endHeight) => setOptions({ endHeight })}
        value={draft.options.endHeight}
      />
      <p className="text-xs text-muted-foreground">
        Absolute Site heights in metres. Transitions and slope are editable after creation.
      </p>
      {(draft.error || previewError) && (
        <p className="text-xs text-red-500" role="alert">
          {draft.error ?? previewError}
        </p>
      )}
      <button
        className="rounded-full border border-border px-3 py-1 text-xs disabled:opacity-50"
        disabled={!draft.segments.length || !!draft.pendingEnd}
        onClick={finish}
        type="button"
      >
        Create ramp
      </button>
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
