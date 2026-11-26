'use client'

import { type AnyNode, resolveSiteGround, type SceneApi } from '@pascal-app/core'
import { useEditor, useRegistryToolContext, visibleScene } from '@pascal-app/editor'
import { Html } from '@react-three/drei'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useState } from 'react'
import type { Camera } from 'three'
import { GardenDraftPreview, GardenToolTarget } from '../shared/garden-draft-preview'
import { GardenPreviewLine } from '../shared/garden-preview-line'
import { siteFrame } from '../shared/site-frame'
import { lawnBrushColor, useLawnAuthoring } from './brush'
import { useLawnBrushController, useLawnNavigationGuard } from './brush-controller'
import { useLawnDraft, useLawnDraftController } from './draft'
import { snapLawnPoint } from './placement'
import { lawnPointerPoint } from './tool-ground'

type Point = [number, number]
type LawnSettings = ReturnType<typeof useLawnAuthoring.getState>
type LawnCanvasControls = {
  sceneApi: SceneApi
  siteId?: string
  mode: LawnSettings['mode']
  addPoint: (point: Point) => void
  finish: () => void
  brush: Pick<ReturnType<typeof useLawnBrushController>, 'start' | 'move' | 'cancel'>
  isCameraDragging: () => boolean
}
type LawnCanvasInput = LawnCanvasControls & {
  camera: Camera
  canvas: HTMLCanvasElement
  navigationAllows: ReturnType<typeof useLawnNavigationGuard>
  setCursor: (point: Point | null) => void
}
type LawnPress = { clickEligible: boolean }

function consumeLawnInput(event: Event) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function ownsLawnInput(event: { target: EventTarget | null }, context: LawnCanvasInput) {
  return (
    visibleScene(useEditor.getState()) !== '2d' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    event.target instanceof HTMLCanvasElement &&
    !context.isCameraDragging()
  )
}

function lawnGroundPoint(event: MouseEvent, context: LawnCanvasInput) {
  const nodes: Readonly<Record<string, AnyNode | undefined>> = context.sceneApi.nodes()
  const site = context.siteId ? nodes[context.siteId] : null
  return lawnPointerPoint(
    event,
    context.camera,
    context.canvas,
    site?.type === 'site' ? site : null,
  )
}

function moveLawnCursor(event: PointerEvent, context: LawnCanvasInput, press: LawnPress) {
  if (context.isCameraDragging()) {
    press.clickEligible = false
    context.brush.cancel()
    context.setCursor(null)
    return
  }
  if (!ownsLawnInput(event, context)) return
  if (!context.navigationAllows(event)) {
    press.clickEligible = false
    context.brush.cancel()
    context.setCursor(null)
    return
  }
  const point = lawnGroundPoint(event, context)
  if (!point) {
    context.setCursor(null)
    return
  }
  if (context.mode === 'brush') {
    context.setCursor(point)
    context.brush.move(point, event)
  } else useLawnDraft.setState({ hover: snapLawnPoint(point, event.altKey) })
}

function beginLawnPress(event: PointerEvent, context: LawnCanvasInput, press: LawnPress) {
  press.clickEligible = false
  if (
    !ownsLawnInput(event, context) ||
    !context.navigationAllows(event) ||
    event.button !== 0 ||
    event.isPrimary === false
  )
    return
  const point = lawnGroundPoint(event, context)
  if (!point) return
  press.clickEligible = true
  consumeLawnInput(event)
  if (context.mode === 'brush') {
    context.setCursor(point)
    context.brush.start(point, event)
  }
}

function clickLawnArea(event: MouseEvent, context: LawnCanvasInput, press: LawnPress) {
  const eligible = press.clickEligible
  press.clickEligible = false
  if (
    !eligible ||
    !ownsLawnInput(event, context) ||
    !context.navigationAllows(event) ||
    event.button !== 0
  )
    return
  consumeLawnInput(event)
  if (context.mode !== 'area') return
  const point = lawnGroundPoint(event, context)
  if (point) context.addPoint(snapLawnPoint(point, event.altKey))
}

function installLawnCanvasInput(context: LawnCanvasInput) {
  const press: LawnPress = { clickEligible: false }
  const move = (event: PointerEvent) => moveLawnCursor(event, context, press)
  const down = (event: PointerEvent) => beginLawnPress(event, context, press)
  const click = (event: MouseEvent) => clickLawnArea(event, context, press)
  const cancel = () => {
    press.clickEligible = false
    context.brush.cancel()
  }
  // The second click of a double-click repeats the last point and is dropped; the outline closes.
  const doubleClick = (event: MouseEvent) => {
    if (context.mode !== 'area' || event.button !== 0 || !ownsLawnInput(event, context)) return
    consumeLawnInput(event)
    context.finish()
  }
  context.canvas.addEventListener('dblclick', doubleClick, true)
  context.canvas.addEventListener('pointermove', move, true)
  context.canvas.addEventListener('pointerdown', down, true)
  context.canvas.addEventListener('click', click, true)
  context.canvas.addEventListener('pointercancel', cancel, true)
  return () => {
    context.canvas.removeEventListener('dblclick', doubleClick, true)
    context.canvas.removeEventListener('pointermove', move, true)
    context.canvas.removeEventListener('pointerdown', down, true)
    context.canvas.removeEventListener('click', click, true)
    context.canvas.removeEventListener('pointercancel', cancel, true)
  }
}

function useLawnCanvasInput({
  sceneApi,
  siteId,
  mode,
  addPoint,
  finish,
  brush,
  isCameraDragging,
}: LawnCanvasControls) {
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  const navigationAllows = useLawnNavigationGuard()
  const [cursor, setCursor] = useState<Point | null>(null)
  const { start, move, cancel } = brush
  useEffect(
    () =>
      installLawnCanvasInput({
        sceneApi,
        siteId,
        mode,
        addPoint,
        finish,
        isCameraDragging,
        camera,
        canvas,
        navigationAllows,
        setCursor,
        brush: { start, move, cancel },
      }),
    [
      sceneApi,
      siteId,
      mode,
      addPoint,
      finish,
      isCameraDragging,
      camera,
      canvas,
      navigationAllows,
      start,
      move,
      cancel,
    ],
  )
  return cursor
}

export default function LawnTool() {
  const context = useRegistryToolContext()
  const frame = siteFrame(context.sceneApi, context.activeLevelId)
  const settings = useLawnAuthoring()
  const finishTool = useCallback(() => useEditor.getState().setTool(null), [])
  const draft = useLawnDraftController({
    ...context,
    siteId: frame?.site.id,
    finishTool,
    view: '3d',
  })
  const brush = useLawnBrushController({
    ...context,
    siteId: frame?.site.id,
    finishTool,
    view: '3d',
  })
  const cursor = useLawnCanvasInput({
    ...context,
    siteId: frame?.site.id,
    mode: settings.mode,
    addPoint: draft.addPoint,
    finish: draft.finish,
    brush,
  })
  return (
    <LawnFeedback
      cursor={cursor}
      error={settings.mode === 'brush' ? brush.message : draft.error}
      siteId={frame?.site.id}
      sceneApi={context.sceneApi}
      settings={settings}
    />
  )
}

function LawnBrushCursor({
  cursor,
  settings,
  elevate,
}: {
  cursor: Point
  settings: LawnSettings
  elevate: (point: Point) => [number, number, number]
}) {
  return (
    <>
      {[0.25, 0.5, 0.75, 1].map((fraction) => (
        <GardenPreviewLine
          key={fraction}
          points={Array.from({ length: 65 }, (_, i) =>
            elevate([
              cursor[0] + Math.cos((i * Math.PI) / 32) * settings.radiusM * fraction,
              cursor[1] + Math.sin((i * Math.PI) / 32) * settings.radiusM * fraction,
            ]),
          )}
          color={lawnBrushColor[settings.effect]}
          opacity={(1 - fraction * 0.7) * 0.6}
          lineWidth={2}
        />
      ))}
    </>
  )
}

function LawnFeedback({
  cursor,
  error,
  siteId,
  sceneApi,
  settings,
}: {
  cursor: Point | null
  error: string | null
  siteId?: string
  sceneApi: SceneApi
  settings: LawnSettings
}) {
  const scene = useThree((state) => state.scene)
  const ground = resolveSiteGround(siteId, sceneApi.nodes())
  const elevate = ([x, z]: Point): [number, number, number] => [x, ground.heightAt(x, z) + 0.035, z]
  const points = useLawnDraft((draft) => draft.points)
  const hover = useLawnDraft((draft) => draft.hover)
  const first = points[0]
  const anchor = settings.mode === 'brush' ? cursor : first
  return createPortal(
    <group userData={{ pascalExport: 'strip' }}>
      {settings.mode === 'area' && (
        <GardenDraftPreview
          closed
          ground={ground}
          hover={hover}
          invalid={!!error}
          lift={0.035}
          points={points}
        />
      )}
      {/* The ring keeps the colour of its effect, as the terrain brush's ring keeps its verb's. */}
      {settings.mode === 'brush' && <GardenToolTarget at={cursor} ground={ground} />}
      {settings.mode === 'brush' && cursor && (
        <LawnBrushCursor cursor={cursor} settings={settings} elevate={elevate} />
      )}
      {error && anchor && (
        <Html position={elevate(anchor)} style={{ pointerEvents: 'none', width: 260 }}>
          <p className="rounded-lg bg-background p-2 text-xs text-foreground" role="status">
            {error}
          </p>
        </Html>
      )}
    </group>,
    scene,
  )
}
