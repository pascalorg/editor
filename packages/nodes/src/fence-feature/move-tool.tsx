'use client'
import { emitter, type FenceEvent, type FenceFeatureNode, type GridEvent } from '@pascal-app/core'
import {
  consumePlacementDragRelease,
  markToolCancelConsumed,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useEffect } from 'react'
import { createFenceFeatureMoveSession } from './move-session'

export default function MoveFenceFeatureTool({ node }: { node: FenceFeatureNode }) {
  useEffect(() => {
    const session = createFenceFeatureMoveSession(node)
    let finished = false
    const finish = () => {
      if (finished || !session.canCommit()) return
      finished = true
      session.commit()
      triggerSFX('sfx:item-place')
      useEditor.getState().setMovingNode(null)
    }
    const move = (event: GridEvent) =>
      session.update([event.localPosition[0], event.localPosition[2]], undefined, event.localRay)
    const click = (event: GridEvent) => {
      move(event)
      finish()
    }
    const fenceMove = (event: FenceEvent) =>
      session.update([event.localPosition[0], event.localPosition[2]], event.node)
    const fenceClick = (event: FenceEvent) => {
      fenceMove(event)
      if (session.canCommit()) {
        event.stopPropagation()
        finish()
      }
    }
    const cancel = () => {
      session.clear()
      markToolCancelConsumed()
      useEditor.getState().setMovingNode(null)
    }
    const release = (event: PointerEvent) => {
      if (consumePlacementDragRelease(event)) finish()
    }
    emitter.on('grid:move', move)
    emitter.on('grid:click', click)
    emitter.on('fence:move', fenceMove)
    emitter.on('fence:click', fenceClick)
    emitter.on('tool:cancel', cancel)
    window.addEventListener('pointerup', release)
    return () => {
      session.clear()
      emitter.off('grid:move', move)
      emitter.off('grid:click', click)
      emitter.off('fence:move', fenceMove)
      emitter.off('fence:click', fenceClick)
      emitter.off('tool:cancel', cancel)
      window.removeEventListener('pointerup', release)
    }
  }, [node])
  return null
}
