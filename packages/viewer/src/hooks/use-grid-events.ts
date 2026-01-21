import { type EventSuffix, emitter, type GridEvent } from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'

export function useGridEvents() {
  const emit = (suffix: EventSuffix, e: ThreeEvent<PointerEvent>) => {
    const eventKey = `grid:${suffix}` as `grid:${EventSuffix}`
    const payload: GridEvent = {
      position: [e.point.x, e.point.y, e.point.z],
    }

    emitter.emit(eventKey, payload)
  }

  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      emit('pointerdown', e)
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      emit('pointerup', e)
    },
    onClick: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      emit('click', e)
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => emit('enter', e),
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => emit('leave', e),
    onPointerMove: (e: ThreeEvent<PointerEvent>) => emit('move', e),
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => emit('double-click', e),
    onContextMenu: (e: ThreeEvent<PointerEvent>) => emit('context-menu', e),
  }
}
