'use client'

import {
  emitter,
  type GridEvent,
  type HedgeNode,
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
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { createHedgeMoveSession } from './floorplan-move'

/** The plan and canvas share the same Site-space path move and single committed write. */
export default function MoveHedgeTool({ node }: { node: HedgeNode }) {
  const original = useRef(node)
  useEffect(() => {
    const initial = original.current
    const session = createHedgeMoveSession({ node: initial, nodes: useScene.getState().nodes })
    const raycasts = new Map<Object3D, Object3D['raycast']>()
    const disableRaycasts = () =>
      sceneRegistry.nodes.get(initial.id)?.traverse((child) => {
        if (raycasts.has(child)) return
        raycasts.set(child, child.raycast)
        child.raycast = () => {}
      })
    disableRaycasts()
    const owns = (event: { target: EventTarget | null }) =>
      visibleScene(useEditor.getState()) !== '2d' &&
      typeof HTMLCanvasElement !== 'undefined' &&
      event.target instanceof HTMLCanvasElement
    const clear = () => {
      useLiveNodeOverrides.getState().clear(initial.id)
      useScene.getState().markDirty(initial.id)
    }
    const cancel = () => {
      clear()
      markToolCancelConsumed()
      useEditor.getState().setMovingNode(null)
    }
    let moved = false
    const move = (event: GridEvent) => {
      if (!event.nativeEvent || !owns(event.nativeEvent) || event.nativeEvent.buttons & 0b110)
        return
      disableRaycasts()
      session.apply({
        planPoint: [event.position[0], event.position[2]],
        modifiers: {
          altKey: event.nativeEvent.altKey,
          shiftKey: event.nativeEvent.shiftKey,
          ctrlKey: event.nativeEvent.ctrlKey,
          metaKey: event.nativeEvent.metaKey,
        },
      })
      moved = true
    }
    const commit = () => {
      if (!moved || !session.canCommit()) return
      session.commit?.()
      useEditor.getState().setMovingNode(null)
    }
    const click = subscribeFloorPlacementClicks((event) => {
      if (!event.nativeEvent || !owns(event.nativeEvent)) return
      stopPlacementCommitPropagation(event)
      commit()
    })
    const release = (event: PointerEvent) => {
      if (owns(event) && consumePlacementDragRelease(event)) commit()
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
    return () => {
      emitter.off('grid:move', move)
      emitter.off('tool:cancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerup', release)
      click()
      clear()
      for (const [child, raycast] of raycasts) child.raycast = raycast
    }
  }, [])
  return null
}
