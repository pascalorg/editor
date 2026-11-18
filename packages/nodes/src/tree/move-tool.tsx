'use client'

import {
  emitter,
  type FloorplanMoveTargetSession,
  type GridEvent,
  sceneRegistry,
  type TreeNode,
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
import { clearTreeMovePreview, createTreeMoveSession } from './floorplan-move'
import { ownsTreePlacement } from './placement'

function treeRaycastGuard(id: TreeNode['id']) {
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

function createTreeMoveHandlers(
  node: TreeNode,
  session: FloorplanMoveTargetSession,
  beforeMove: () => void,
) {
  let moved = false
  let active = true
  const cancel = () => {
    if (!active) return
    active = false
    clearTreeMovePreview(node.id)
    markToolCancelConsumed()
    useEditor.getState().setMovingNode(null)
  }
  const commit = () => {
    if (!active || !moved || !session.canCommit()) return
    active = false
    session.commit?.()
    useEditor.getState().setMovingNode(null)
  }
  const move = (event: GridEvent) => {
    const native = event.nativeEvent
    if (!active || !native || !ownsTreePlacement('3d', native.target) || native.buttons & 0b110)
      return
    beforeMove()
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
  return { cancel, commit, move }
}

function subscribeTreeMoveEndings({
  cancel,
  commit,
}: Pick<ReturnType<typeof createTreeMoveHandlers>, 'cancel' | 'commit'>): () => void {
  const click = subscribeFloorPlacementClicks((event) => {
    if (!ownsTreePlacement('3d', event.nativeEvent?.target ?? null)) return
    stopPlacementCommitPropagation(event)
    commit()
  })
  const release = (event: PointerEvent) => {
    if (ownsTreePlacement('3d', event.target) && consumePlacementDragRelease(event)) commit()
  }
  const pointerCancel = (event: PointerEvent) => {
    if (ownsTreePlacement('3d', event.target)) cancel()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || isTypingTarget(event.target)) return
    event.preventDefault()
    cancel()
  }
  window.addEventListener('keydown', key)
  window.addEventListener('pointerup', release)
  window.addEventListener('pointercancel', pointerCancel)
  return () => {
    window.removeEventListener('keydown', key)
    window.removeEventListener('pointerup', release)
    window.removeEventListener('pointercancel', pointerCancel)
    click()
  }
}

function subscribeTreeMove(node: TreeNode, session: FloorplanMoveTargetSession): () => void {
  const raycasts = treeRaycastGuard(node.id)
  raycasts.disable()
  const { cancel, commit, move } = createTreeMoveHandlers(node, session, raycasts.disable)
  const endInputs = subscribeTreeMoveEndings({ cancel, commit })
  emitter.on('grid:move', move)
  emitter.on('tool:cancel', cancel)
  return () => {
    emitter.off('grid:move', move)
    emitter.off('tool:cancel', cancel)
    endInputs()
    clearTreeMovePreview(node.id)
    raycasts.restore()
  }
}

export default function MoveTreeTool({ node }: { node: TreeNode }) {
  const original = useRef(node)
  useEffect(() => {
    const initial = original.current
    const session = createTreeMoveSession({ node: initial, nodes: useScene.getState().nodes })
    return subscribeTreeMove(initial, session)
  }, [])
  return null
}
