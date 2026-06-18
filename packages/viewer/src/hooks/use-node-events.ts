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

  // Camera drags (orbit / pan / dolly) suppress ALL node pointer events.
  //
  // `inputDragging` (host-driven drags: handle arrows, press-drag moves)
  // additionally suppresses the SELECTION events — without it the click
  // synthesized on pointer-release would reroute selection to whatever mesh
  // sits under the cursor at release. It must NOT suppress the SPATIAL events
  // (`enter` / `move` / `leave`): a surface-following move tool — a door /
  // window sliding along a wall — runs WITH `inputDragging` set and depends on
  // those events to track the cursor. Consumers that should ignore drag-time
  // spatial events gate on `inputDragging` themselves (the editor's hover and
  // paint paths, box-select), so emitting them during a drag only reaches the
  // active move tool that wants them.
  const spatialSuppressed = () => useViewer.getState().cameraDragging
  const selectionSuppressed = () => {
    const s = useViewer.getState()
    return s.cameraDragging || s.inputDragging
  }

  return {
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      if (selectionSuppressed()) return
      if (e.button !== 0) return
      emit('pointerdown', e)
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (selectionSuppressed()) return
      if (e.button !== 0) return
      emit('pointerup', e)
      // Synthesize a click event on pointer up to be more forgiving than R3F's default onClick
      // which often fails if the mouse moves even 1 pixel.
      emit('click', e)
    },
    onClick: (_e: ThreeEvent<PointerEvent>) => {
      // Disable default R3F click since we synthesize it on pointerup
      // This prevents double-clicks from firing twice.
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => {
      if (spatialSuppressed()) return
      emit('enter', e)
    },
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => {
      if (spatialSuppressed()) return
      emit('leave', e)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (spatialSuppressed()) return
      emit('move', e)
    },
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => {
      if (selectionSuppressed()) return
      emit('double-click', e)
    },
    onContextMenu: (e: ThreeEvent<PointerEvent>) => {
      if (selectionSuppressed()) return
      emit('context-menu', e)
    },
  }
}
