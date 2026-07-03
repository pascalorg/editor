'use client'

import { type AnyNodeId, emitter, type GridEvent, sceneRegistry } from '@pascal-app/core'
import { useEffect } from 'react'
import type { Object3D } from 'three'
import { lastGridMoveRef } from './use-grid-events'
import { markToolCancelConsumed } from './use-keyboard'
import { floorItemDragSuppressClickRef } from '../lib/floor-item-drag'
import useEditor from '../store/use-editor'

export type UsePlanGridDragOptions = {
  active: boolean
  /** Skip 3D grid drag when the floor plan owns the gesture. */
  deferWhenFloorplanHovered?: boolean
  nodeId?: AnyNodeId
  onGridMove: (event: GridEvent) => void
  onCommit: () => void
  onCancel: () => void
  /** Disable mesh raycasts so the dragged node does not steal pointer hits. */
  suppressMeshRaycast?: boolean
  /** Apply the latest grid position immediately on activation. */
  warmStart?: boolean
  /** Set while committing so synthesized clicks are ignored. */
  suppressClickOnCommit?: boolean
}

/**
 * Shared 3D plan drag session: grid:move preview + pointerup commit.
 * Used by segment movers (wall / pipe / fence) and position movers (stair / item).
 */
export function usePlanGridDrag({
  active,
  deferWhenFloorplanHovered = true,
  nodeId,
  onGridMove,
  onCommit,
  onCancel,
  suppressMeshRaycast = false,
  warmStart = true,
  suppressClickOnCommit = true,
}: UsePlanGridDragOptions) {
  useEffect(() => {
    if (!active) return
    if (deferWhenFloorplanHovered && useEditor.getState().isFloorplanHovered) return

    let committed = false
    let hasMoved = false

    const restoreRaycasts: Array<() => void> = []
    if (suppressMeshRaycast && nodeId) {
      const mesh = sceneRegistry.nodes.get(nodeId)
      if (mesh) {
        mesh.traverse((child: Object3D) => {
          const original = child.raycast
          child.raycast = () => {}
          restoreRaycasts.push(() => {
            child.raycast = original
          })
        })
      }
    }

    const handleGridMove = (event: GridEvent) => {
      hasMoved = true
      onGridMove(event)
    }

    if (warmStart && lastGridMoveRef.localPosition) {
      handleGridMove({ localPosition: lastGridMoveRef.localPosition } as GridEvent)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      if (!hasMoved) return
      if (committed) return
      committed = true
      if (suppressClickOnCommit) {
        floorItemDragSuppressClickRef.current = true
      }
      onCommit()
    }

    const handleCancel = () => {
      if (committed) return
      markToolCancelConsumed()
      onCancel()
    }

    emitter.on('grid:move', handleGridMove)
    window.addEventListener('pointerup', handlePointerUp)
    emitter.on('tool:cancel', handleCancel)

    return () => {
      emitter.off('grid:move', handleGridMove)
      window.removeEventListener('pointerup', handlePointerUp)
      emitter.off('tool:cancel', handleCancel)
      for (const restore of restoreRaycasts) restore()
      if (!committed) {
        onCancel()
      }
    }
  }, [
    active,
    deferWhenFloorplanHovered,
    nodeId,
    onCancel,
    onCommit,
    onGridMove,
    suppressClickOnCommit,
    suppressMeshRaycast,
    warmStart,
  ])
}
