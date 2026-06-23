import {
  type AnyNode,
  type AnyNodeType,
  type EventSuffix,
  emitter,
  type NodeEvent,
} from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'
import { useRef } from 'react'
import {
  isViewerSelectionInputSuppressed,
  isViewerSpatialInputSuppressed,
  shouldLatchViewerPointerSuppression,
} from '../store/use-viewer'

// Derive `{ node, event }` per kind directly from the `AnyNode`
// discriminated union — no hand-maintained kind→type map. Adding a new
// kind to `AnyNode` automatically makes it valid here; removing one
// removes its overload. `Extract<AnyNode, { type: K }>` picks the node
// shape, `NodeEvent<T>` adapts the bus payload to that shape.
type NodeByKind<K extends AnyNodeType> = Extract<AnyNode, { type: K }>

export function useNodeEvents<K extends AnyNodeType>(node: NodeByKind<K>, type: K) {
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const suppressedPointerRef = useRef(false)
  const suppressNativeClickUntilRef = useRef(0)

  const emit = (suffix: EventSuffix, e: ThreeEvent<PointerEvent>) => {
    const eventKey = `${type}:${suffix}` as `${K}:${EventSuffix}`
    const localPoint = e.object.worldToLocal(e.point.clone())
    const payload: NodeEvent<NodeByKind<K>> = {
      node,
      position: [e.point.x, e.point.y, e.point.z],
      localPosition: [localPoint.x, localPoint.y, localPoint.z],
      normal: e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
      faceIndex: e.faceIndex ?? undefined,
      object: e.object,
      stopPropagation: () => e.stopPropagation(),
      nativeEvent: e,
    }

    // `emitter.emit` is typed over a fixed union of `${kind}:${suffix}`
    // keys; the `as never` cast lets us emit a kind-specific payload
    // through that generic surface without enumerating every kind.
    emitter.emit(eventKey, payload as never)
  }

  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      if (isViewerSelectionInputSuppressed()) {
        suppressedPointerRef.current = shouldLatchViewerPointerSuppression()
        suppressNativeClickUntilRef.current = performance.now() + 1000
        window.addEventListener(
          'pointerup',
          () => {
            suppressedPointerRef.current = false
          },
          { once: true },
        )
        return
      }
      emit('pointerdown', e)
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (e.button !== 0) return
      if (suppressedPointerRef.current) {
        suppressedPointerRef.current = false
        return
      }
      if (isViewerSelectionInputSuppressed()) return
      emit('pointerup', e)
      // Synthesize a click event on pointer up to be more forgiving than R3F's default onClick
      // which often fails if the mouse moves even 1 pixel.
      emit('click', e)
      const now = performance.now()
      const lastClick = lastClickRef.current
      const dx = lastClick ? e.nativeEvent.clientX - lastClick.x : Infinity
      const dy = lastClick ? e.nativeEvent.clientY - lastClick.y : Infinity
      if (
        e.nativeEvent.detail >= 2 ||
        (lastClick && now - lastClick.time <= 800 && Math.hypot(dx, dy) <= 6)
      ) {
        suppressNativeClickUntilRef.current = performance.now() + 1000
        emit('double-click', e)
        lastClickRef.current = null
        return
      }
      lastClickRef.current = {
        time: now,
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      }
    },
    onClick: (_e: ThreeEvent<PointerEvent>) => {
      // Disable default R3F click since we synthesize it on pointerup
      // This prevents double-clicks from firing twice.
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => {
      if (isViewerSpatialInputSuppressed()) return
      emit('enter', e)
    },
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => {
      if (isViewerSpatialInputSuppressed()) return
      emit('leave', e)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (isViewerSpatialInputSuppressed()) return
      emit('move', e)
    },
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => {
      if (performance.now() < suppressNativeClickUntilRef.current) return
      if (isViewerSelectionInputSuppressed()) return
    },
    onContextMenu: (e: ThreeEvent<PointerEvent>) => {
      if (isViewerSelectionInputSuppressed()) return
      emit('context-menu', e)
    },
  }
}
