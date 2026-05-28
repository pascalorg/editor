import {
  type AnyNode,
  type AnyNodeType,
  type EventSuffix,
  emitter,
  type NodeEvent,
} from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'
import useViewer from '../store/use-viewer'

// Derive `{ node, event }` per kind directly from the `AnyNode`
// discriminated union — no hand-maintained kind→type map. Adding a new
// kind to `AnyNode` automatically makes it valid here; removing one
// removes its overload. `Extract<AnyNode, { type: K }>` picks the node
// shape, `NodeEvent<T>` adapts the bus payload to that shape.
type NodeByKind<K extends AnyNodeType> = Extract<AnyNode, { type: K }>

export function useNodeEvents<K extends AnyNodeType>(node: NodeByKind<K>, type: K) {
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

  // Suppress node pointer events while an interaction drag is in
  // progress. `cameraDragging` covers orbit/pan/dolly; `inputDragging`
  // covers host-driven drags (editor handle arrows etc.). Without
  // this, the synthesized click on pointerup would reroute selection
  // to whatever mesh the cursor lands on at release.
  const isInteractionActive = () => {
    const s = useViewer.getState()
    return s.cameraDragging || s.inputDragging
  }

  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      if (e.button !== 0) return
      emit('pointerdown', e)
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      if (e.button !== 0) return
      emit('pointerup', e)
      // Synthesize a click event on pointer up to be more forgiving than R3F's default onClick
      // which often fails if the mouse moves even 1 pixel.
      emit('click', e)
    },
    onClick: (e: ThreeEvent<PointerEvent>) => {
      // Disable default R3F click since we synthesize it on pointerup
      // This prevents double-clicks from firing twice.
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      emit('enter', e)
    },
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      emit('leave', e)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      emit('move', e)
    },
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      emit('double-click', e)
    },
    onContextMenu: (e: ThreeEvent<PointerEvent>) => {
      if (isInteractionActive()) return
      emit('context-menu', e)
    },
  }
}
