'use client'

import {
  type AnyNode,
  emitter,
  type LawnNode,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  beginGesture,
  consumePlacementDragRelease,
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  useRegistryToolContext,
  visibleScene,
} from '@pascal-app/editor'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type { Camera } from 'three'
import { createNodeRaycastGuard } from '../shared/site-move-tool'
import { useLawnNavigationGuard } from './brush-controller'
import { createLawnMoveSession } from './floorplan-move'
import { lawnPointerPoint } from './tool-ground'

type MoveContext = {
  node: LawnNode
  camera: Camera
  canvas: HTMLCanvasElement
  navigationAllows: ReturnType<typeof useLawnNavigationGuard>
  isCameraDragging: () => boolean
}
type MovePress = { navigationPointer: number | null; suppressClick: boolean }
type MoveSession = ReturnType<typeof createLawnMoveSession>
type MoveGesture = ReturnType<typeof beginGesture>

function clearLawnMove(id: LawnNode['id']) {
  useLiveNodeOverrides.getState().clear(id)
  useScene.getState().markDirty(id)
}

function beginLawnMove(node: LawnNode) {
  const gesture = beginGesture({
    kind: 'lawn-move',
    ownsScope: (scope) => scope.kind === 'moving' && scope.nodeId === node.id,
    onCancel: () => {
      clearLawnMove(node.id)
      useEditor.getState().setMovingNode(null)
    },
    stale: () => useScene.getState().nodes[node.id]?.type !== 'lawn',
  })
  gesture.trackOverride(node.id)
  return gesture
}

function ownsLawnMove(event: { target: EventTarget | null }) {
  return (
    visibleScene(useEditor.getState()) !== '2d' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    event.target instanceof HTMLCanvasElement
  )
}

function beginLawnMovePress(event: PointerEvent, context: MoveContext, press: MovePress) {
  if (!ownsLawnMove(event)) return
  press.suppressClick =
    context.isCameraDragging() ||
    !context.navigationAllows(event) ||
    event.button !== 0 ||
    event.isPrimary === false
  press.navigationPointer = press.suppressClick ? event.pointerId : null
}

function previewLawnMove(
  event: PointerEvent,
  context: MoveContext,
  press: MovePress,
  session: MoveSession,
  gesture: MoveGesture,
  disableRaycasts: () => void,
) {
  if (!ownsLawnMove(event) || !gesture.active || press.navigationPointer === event.pointerId) return
  if (context.isCameraDragging() || !context.navigationAllows(event)) {
    if (event.buttons) {
      press.navigationPointer = event.pointerId
      press.suppressClick = true
    }
    return
  }
  const nodes: Readonly<Record<string, AnyNode | undefined>> = useScene.getState().nodes
  const parent = context.node.parentId ? nodes[context.node.parentId] : null
  const point = lawnPointerPoint(
    event,
    context.camera,
    context.canvas,
    parent?.type === 'site' ? parent : null,
  )
  if (!point) return
  disableRaycasts()
  session.apply({
    planPoint: point,
    modifiers: {
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    },
  })
}

function clickLawnMove(
  event: MouseEvent,
  context: MoveContext,
  press: MovePress,
  commit: () => void,
) {
  const suppressed = press.suppressClick
  press.suppressClick = false
  if (
    suppressed ||
    context.isCameraDragging() ||
    !ownsLawnMove(event) ||
    !context.navigationAllows(event) ||
    event.button !== 0
  )
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  commit()
}

function releaseLawnMove(
  event: PointerEvent,
  context: MoveContext,
  press: MovePress,
  commit: () => void,
) {
  if (press.navigationPointer === event.pointerId) {
    press.navigationPointer = null
    press.suppressClick = true
    return
  }
  if (context.isCameraDragging() || !context.navigationAllows(event)) {
    press.suppressClick = true
    return
  }
  if (ownsLawnMove(event) && context.navigationAllows(event) && consumePlacementDragRelease(event))
    commit()
}

function installLawnMoveEvents(
  context: MoveContext,
  session: MoveSession,
  gesture: MoveGesture,
  disableRaycasts: () => void,
) {
  const press: MovePress = { navigationPointer: null, suppressClick: false }
  const cancel = () => {
    markToolCancelConsumed()
    gesture.cancel()
  }
  const commit = () => {
    if (context.isCameraDragging() || !session.canCommit()) return
    gesture.finish(() => {
      session.commit?.()
      useEditor.getState().setMovingNode(null)
    })
  }
  const down = (event: PointerEvent) => beginLawnMovePress(event, context, press)
  const move = (event: PointerEvent) =>
    previewLawnMove(event, context, press, session, gesture, disableRaycasts)
  const click = (event: MouseEvent) => clickLawnMove(event, context, press, commit)
  const release = (event: PointerEvent) => releaseLawnMove(event, context, press, commit)
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isTypingTarget(event.target)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    cancel()
  }
  context.canvas.addEventListener('pointerdown', down, true)
  context.canvas.addEventListener('pointermove', move, true)
  context.canvas.addEventListener('click', click, true)
  emitter.on('tool:cancel', cancel)
  window.addEventListener('keydown', key, true)
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', cancel, true)
  return () => {
    context.canvas.removeEventListener('pointerdown', down, true)
    context.canvas.removeEventListener('pointermove', move, true)
    context.canvas.removeEventListener('click', click, true)
    emitter.off('tool:cancel', cancel)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', cancel, true)
  }
}

export default function MoveLawnTool({ node }: { node: LawnNode }) {
  const { isCameraDragging } = useRegistryToolContext()
  const navigationAllows = useLawnNavigationGuard()
  const camera = useThree((state) => state.camera)
  const canvas = useThree((state) => state.gl.domElement)
  useEffect(() => {
    const session = createLawnMoveSession({ node, nodes: useScene.getState().nodes })
    const raycasts = createNodeRaycastGuard(node.id)
    raycasts.disable()
    const gesture = beginLawnMove(node)
    const stop = installLawnMoveEvents(
      { node, camera, canvas, navigationAllows, isCameraDragging },
      session,
      gesture,
      raycasts.disable,
    )
    return () => {
      stop()
      gesture.cancel('unmount')
      clearLawnMove(node.id)
      raycasts.restore()
    }
  }, [node, navigationAllows, camera, canvas, isCameraDragging])
  return null
}
