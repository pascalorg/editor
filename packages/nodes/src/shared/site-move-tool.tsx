'use client'

import {
  type AnyNodeId,
  emitter,
  type FloorplanMoveTargetSession,
  type GridEvent,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
  visibleScene,
} from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import { stopPlacementCommitPropagation, subscribeFloorPlacementClicks } from './floor-placement'

/** Temporarily disable raycasting on a node's live meshes while it is being dragged in 3D. */
export function createNodeRaycastGuard(id: AnyNodeId) {
  const raycasts = new Map<Object3D, Object3D['raycast']>()
  return {
    disable() {
      sceneRegistry.nodes.get(id)?.traverse((child) => {
        if (raycasts.has(child)) return
        raycasts.set(child, child.raycast)
        child.raycast = () => {}
      })
    },
    restore() {
      for (const [child, raycast] of raycasts) child.raycast = raycast
    },
  }
}

const defaultClearPreview = (id: AnyNodeId) => {
  useLiveNodeOverrides.getState().clear(id)
  useScene.getState().markDirty(id)
}

const defaultOwnsEvent = (target: EventTarget | null) =>
  visibleScene(useEditor.getState()) !== '2d' &&
  typeof HTMLCanvasElement !== 'undefined' &&
  target instanceof HTMLCanvasElement

type SiteMoveToolProps<N extends { id: AnyNodeId }> = {
  node: N
  createSession: (args: {
    node: N
    nodes: ReturnType<typeof useScene.getState>['nodes']
  }) => FloorplanMoveTargetSession
  ownsEvent?: (target: EventTarget | null) => boolean
  clearPreview?: (id: N['id']) => void
  requireMoveToCommit?: boolean
  handlePointerCancel?: boolean
}

/** Shared canvas move controller for Site-hosted garden nodes reusing their plan move session. */
export function SiteMoveTool<N extends { id: AnyNodeId }>({
  node,
  createSession,
  ownsEvent = defaultOwnsEvent,
  clearPreview = defaultClearPreview,
  requireMoveToCommit = true,
  handlePointerCancel = false,
}: SiteMoveToolProps<N>) {
  const original = useRef(node)
  const latestProps = useRef({
    createSession,
    ownsEvent,
    clearPreview,
    requireMoveToCommit,
    handlePointerCancel,
  })
  latestProps.current = {
    createSession,
    ownsEvent,
    clearPreview,
    requireMoveToCommit,
    handlePointerCancel,
  }
  useEffect(() => {
    const initial = original.current
    const props = latestProps.current
    const session = props.createSession({ node: initial, nodes: useScene.getState().nodes })
    const raycasts = createNodeRaycastGuard(initial.id)
    raycasts.disable()
    let moved = false
    let active = true
    const cancel = () => {
      if (!active) return
      active = false
      latestProps.current.clearPreview(initial.id)
      markToolCancelConsumed()
      useEditor.getState().setMovingNode(null)
    }
    const commit = () => {
      if (!active || (latestProps.current.requireMoveToCommit && !moved) || !session.canCommit())
        return
      active = false
      session.commit?.()
      useEditor.getState().setMovingNode(null)
    }
    const move = (event: GridEvent) => {
      const native = event.nativeEvent
      if (
        !active ||
        !native ||
        !latestProps.current.ownsEvent(native.target) ||
        native.buttons & 0b110
      )
        return
      raycasts.disable()
      session.apply({
        planPoint: [event.position[0], event.position[2]],
        modifiers: {
          altKey: native.altKey,
          shiftKey: native.shiftKey,
          ctrlKey: native.ctrlKey,
          metaKey: native.metaKey,
        },
      })
      moved = true
    }
    const click = subscribeFloorPlacementClicks((event) => {
      if (!latestProps.current.ownsEvent(event.nativeEvent?.target ?? null)) return
      stopPlacementCommitPropagation(event)
      commit()
    })
    const release = (event: PointerEvent) => {
      if (latestProps.current.ownsEvent(event.target) && consumePlacementDragRelease(event))
        commit()
    }
    const pointerCancel = (event: PointerEvent) => {
      if (latestProps.current.handlePointerCancel && latestProps.current.ownsEvent(event.target))
        cancel()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return
      event.preventDefault()
      cancel()
    }
    emitter.on('grid:move', move)
    emitter.on('tool:cancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('pointerup', release)
    if (props.handlePointerCancel) window.addEventListener('pointercancel', pointerCancel)
    return () => {
      emitter.off('grid:move', move)
      emitter.off('tool:cancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerup', release)
      if (props.handlePointerCancel) window.removeEventListener('pointercancel', pointerCancel)
      click()
      latestProps.current.clearPreview(initial.id)
      raycasts.restore()
    }
  }, [])
  return null
}
