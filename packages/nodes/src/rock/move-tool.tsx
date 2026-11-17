'use client'

import {
  emitter,
  type GridEvent,
  type RockNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  isTypingTarget,
  markToolCancelConsumed,
  useEditor,
} from '@pascal-app/editor'
import { useEffect, useRef } from 'react'
import type { Object3D } from 'three'
import {
  stopPlacementCommitPropagation,
  subscribeFloorPlacementClicks,
} from '../shared/floor-placement'
import { createRockMoveSession } from './floorplan-move'
import { ownsRockPlacement } from './placement'

/** The canvas and plan share the same Site-space move and one committed polygon update. */
export default function MoveRockTool({ node }: { node: RockNode }) {
  const original = useRef(node)
  useEffect(() => {
    const initial = original.current
    const session = createRockMoveSession({ node: initial, nodes: useScene.getState().nodes })
    const raycasts = new Map<Object3D, Object3D['raycast']>()
    const disableRaycasts = () =>
      sceneRegistry.nodes.get(initial.id)?.traverse((child) => {
        if (raycasts.has(child)) return
        raycasts.set(child, child.raycast)
        child.raycast = () => {}
      })
    disableRaycasts()
    const clear = () => {
      useLiveNodeOverrides.getState().clear(initial.id)
      useScene.getState().markDirty(initial.id)
    }
    const cancel = () => {
      clear()
      markToolCancelConsumed()
      useEditor.getState().setMovingNode(null)
    }
    const move = (event: GridEvent) => {
      if (
        !event.nativeEvent ||
        !ownsRockPlacement('3d', event.nativeEvent.target) ||
        event.nativeEvent.buttons & 0b110
      )
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
    }
    const commit = () => {
      if (!session.canCommit()) return
      session.commit?.()
      useEditor.getState().setMovingNode(null)
    }
    const click = subscribeFloorPlacementClicks((event) => {
      if (!ownsRockPlacement('3d', event.nativeEvent?.target ?? null)) return
      stopPlacementCommitPropagation(event)
      commit()
    })
    const release = (event: PointerEvent) => {
      if (ownsRockPlacement('3d', event.target) && consumePlacementDragRelease(event)) commit()
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
    window.addEventListener('pointercancel', cancel)
    return () => {
      emitter.off('grid:move', move)
      emitter.off('tool:cancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', cancel)
      click()
      clear()
      for (const [child, raycast] of raycasts) child.raycast = raycast
    }
  }, [])
  return null
}
