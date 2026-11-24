'use client'

import {
  emitter,
  LAWN_LIMITS,
  type LawnNode,
  type PascalI18n,
  plantingContains,
  type SceneApi,
  usePascalI18n,
} from '@pascal-app/core'
import {
  beginGesture,
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  visibleScene,
} from '@pascal-app/editor'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createLawnBrushStroke, type LawnBrushRefusal, useLawnAuthoring } from './brush'

type Point = [number, number]
type BrushContext = {
  sceneApi: SceneApi
  siteId?: string
  view: '2d' | '3d'
  finishTool: () => void
  isCameraDragging?: () => boolean
}
type BrushRuntime = {
  stroke: ReturnType<typeof createLawnBrushStroke>
  gesture: ReturnType<typeof beginGesture> | null
  pointer: number | null
}
type Refusal = LawnBrushRefusal | 'target'
let activeBrush: { view: '2d' | '3d'; cancel: () => void } | null = null

function refusalMessage(code: Refusal, i18n: PascalI18n): string {
  switch (code) {
    case 'target':
      return i18n._({
        id: 'node.lawn.brush.target',
        message: 'Start inside one lawn area. Overlapping lawns must be edited separately.',
      })
    case 'point-budget':
      return i18n._({
        id: 'node.lawn.brush.full',
        message:
          'This lawn’s {pointBudget}-point budget is full. Remove older strokes to paint again.',
        values: { pointBudget: LAWN_LIMITS.maxStrokePoints.toLocaleString(i18n.getLocale()) },
      })
    case 'flowers-required':
      return i18n._({
        id: 'node.lawn.brush.chooseFlowers',
        message:
          'Choose a flower species and a positive flower density before painting more flowers.',
      })
    case 'lawn_work_budget':
      return i18n._({
        id: 'node.lawn.brush.workBudget',
        message:
          'Lawn work budget reached (32M stroke visits / 250k cells). Use fewer points or a smaller lawn.',
      })
    case 'lawn_terrain_budget':
      return i18n._({
        id: 'node.lawn.brush.terrainBudget',
        message:
          'This lawn exceeds the terrain detail budget. Reduce its outline or simplify the terrain before painting.',
      })
    case 'lawn_empty':
      return i18n._({
        id: 'node.lawn.brush.empty',
        message:
          'No lawn ground remains here. Check the outline and ground owners before painting.',
      })
    case 'changed':
      return i18n._({
        id: 'node.lawn.brush.changed',
        message: 'The lawn changed during this stroke. Start a new stroke on the updated lawn.',
      })
    case 'no_site':
      return i18n._({
        id: 'node.lawn.brush.noSite',
        message: 'This lawn has no owning Site. Restore its Site before painting.',
      })
    case 'invalid-stroke':
      return i18n._({
        id: 'node.lawn.brush.invalid',
        message:
          'This stroke has invalid coordinates or settings. Check the brush settings and try again.',
      })
  }
}

/** Navigation owns Space, middle/right buttons and modified primary presses in both views. */
export function useLawnNavigationGuard() {
  const space = useRef(false)
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space' && !isTypingTarget(event.target)) space.current = true
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') space.current = false
    }
    const blur = () => {
      space.current = false
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [])
  return useCallback(
    (event: {
      target: EventTarget | null
      buttons?: number
      ctrlKey?: boolean
      metaKey?: boolean
      shiftKey?: boolean
    }) =>
      !space.current &&
      !isTypingTarget(event.target) &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      !((event.buttons ?? 0) & 0b110),
    [],
  )
}

function resetBrush(runtime: BrushRuntime, cancel: () => void) {
  runtime.stroke = null
  runtime.pointer = null
  if (activeBrush?.cancel === cancel) activeBrush = null
}

function changedLawn(node: LawnNode, sceneApi: SceneApi): boolean {
  const live = sceneApi.nodes()[node.id]
  return (
    live?.type !== 'lawn' ||
    live.parentId !== node.parentId ||
    live.outline !== node.outline ||
    live.strokes !== node.strokes ||
    live.flowers !== node.flowers ||
    live.flowerDensity !== node.flowerDensity
  )
}

function startBrush(
  point: Point,
  event: PointerEvent,
  context: BrushContext,
  runtime: BrushRuntime,
  cancel: () => void,
  refuse: (code: Refusal) => void,
  onPointCount: (count: number) => void,
): boolean {
  if (
    useLawnAuthoring.getState().mode !== 'brush' ||
    event.button !== 0 ||
    event.isPrimary === false ||
    context.isCameraDragging?.()
  )
    return false
  activeBrush?.cancel()
  cancel()
  const lawns = Object.values(context.sceneApi.nodes()).filter(
    (node) =>
      node.type === 'lawn' &&
      node.visible &&
      (!context.siteId || node.parentId === context.siteId) &&
      plantingContains(node.outline, point[0], point[1]),
  )
  const lawn = lawns.length === 1 ? lawns[0] : null
  if (lawn?.type !== 'lawn') {
    refuse('target')
    return false
  }
  const next = createLawnBrushStroke(lawn, useLawnAuthoring.getState(), point, refuse, onPointCount)
  if (!next) return false
  runtime.stroke = next
  runtime.pointer = event.pointerId
  runtime.gesture = beginGesture({
    kind: 'lawn-brush',
    scope: { kind: 'painting' },
    onCancel: () => {
      next.cancel()
      resetBrush(runtime, cancel)
    },
    stale: () => changedLawn(lawn, context.sceneApi),
  })
  activeBrush = { view: context.view, cancel }
  runtime.gesture.trackOverride(lawn.id)
  if (typeof Element !== 'undefined' && event.target instanceof Element)
    runtime.gesture.capturePointer(event.target, event.pointerId)
  return true
}

const ownsView = (view: BrushContext['view']) =>
  visibleScene(useEditor.getState()) !== (view === '2d' ? '3d' : '2d')

function brushKey(
  event: KeyboardEvent,
  context: BrushContext,
  runtime: BrushRuntime,
  cancel: () => void,
) {
  if (
    useLawnAuthoring.getState().mode !== 'brush' ||
    !ownsView(context.view) ||
    isTypingTarget(event.target) ||
    (activeBrush !== null && activeBrush.view !== context.view)
  )
    return
  if (event.code === 'Space') {
    cancel()
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  markToolCancelConsumed()
  const active = runtime.gesture?.active
  cancel()
  if (!active) context.finishTool()
}

function installBrushEvents(context: BrushContext, runtime: BrushRuntime, cancel: () => void) {
  const release = (event: PointerEvent) => {
    if (event.pointerId !== runtime.pointer) return
    if (
      !ownsView(context.view) ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      context.isCameraDragging?.()
    )
      return cancel()
    const current = runtime.stroke
    if (current) runtime.gesture?.finish(() => current.commit())
    resetBrush(runtime, cancel)
  }
  const navigationPress = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      isTypingTarget(event.target)
    )
      cancel()
  }
  const key = (event: KeyboardEvent) => brushKey(event, context, runtime, cancel)
  const blur = () => cancel()
  const stopView = useEditor.subscribe(() => {
    if (!ownsView(context.view)) cancel()
  })
  window.addEventListener('pointerup', release, true)
  window.addEventListener('pointerdown', navigationPress, true)
  window.addEventListener('pointercancel', blur, true)
  window.addEventListener('lostpointercapture', blur, true)
  window.addEventListener('blur', blur)
  window.addEventListener('keydown', key, true)
  emitter.on('tool:cancel', cancel)
  return () => {
    stopView()
    window.removeEventListener('pointerup', release, true)
    window.removeEventListener('pointerdown', navigationPress, true)
    window.removeEventListener('pointercancel', blur, true)
    window.removeEventListener('lostpointercapture', blur, true)
    window.removeEventListener('blur', blur)
    window.removeEventListener('keydown', key, true)
    emitter.off('tool:cancel', cancel)
    cancel()
  }
}

/** DOM and raycast adapters feed this same Site-space stroke owner. */
export function useLawnBrushController(context: BrushContext) {
  const { sceneApi, siteId, view, finishTool, isCameraDragging } = context
  const i18n = usePascalI18n()
  const mode = useLawnAuthoring((state) => state.mode)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const runtime = useRef<BrushRuntime>({ stroke: null, gesture: null, pointer: null })
  const cancel: () => void = useCallback(() => {
    if (activeBrush?.cancel === cancel) activeBrush = null
    runtime.current.gesture?.cancel()
    runtime.current.stroke?.cancel()
    resetBrush(runtime.current, cancel)
  }, [])
  const refuse = useCallback((code: Refusal) => setError(refusalMessage(code, i18n)), [i18n])
  const onPointCount = useCallback(
    (count: number) => {
      setWarning(
        count >= LAWN_LIMITS.maxStrokePoints * 0.9
          ? i18n._({
              id: 'node.lawn.brush.nearBudget',
              message:
                'Near this lawn’s {pointBudget}-point budget. Remove older strokes to make room.',
              values: { pointBudget: LAWN_LIMITS.maxStrokePoints.toLocaleString(i18n.getLocale()) },
            })
          : null,
      )
    },
    [i18n],
  )
  const start = useCallback(
    (point: Point, event: PointerEvent) => {
      setError(null)
      setWarning(null)
      return startBrush(
        point,
        event,
        { sceneApi, siteId, view, finishTool, isCameraDragging },
        runtime.current,
        cancel,
        refuse,
        onPointCount,
      )
    },
    [sceneApi, siteId, view, finishTool, isCameraDragging, cancel, refuse, onPointCount],
  )
  const move = useCallback(
    (point: Point, event: { pointerId: number }) => {
      const current = runtime.current
      if (
        current.pointer === event.pointerId &&
        current.gesture?.active &&
        !current.stroke?.move(point)
      )
        cancel()
    },
    [cancel],
  )
  useEffect(() => {
    if (mode !== 'brush') {
      cancel()
      return
    }
    return installBrushEvents(
      { sceneApi, siteId, view, finishTool, isCameraDragging },
      runtime.current,
      cancel,
    )
  }, [sceneApi, siteId, view, finishTool, isCameraDragging, cancel, mode])
  return { start, move, cancel, error, message: error ?? warning }
}
