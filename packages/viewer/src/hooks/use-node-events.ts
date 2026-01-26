import {
  type BuildingEvent,
  type BuildingNode,
  type EventSuffix,
  emitter,
  type ItemEvent,
  type ItemNode,
  type SlabEvent,
  type SlabNode,
  type WallEvent,
  type WallNode,
  type ZoneEvent,
  type ZoneNode,
} from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'

type NodeConfig = {
  item: { node: ItemNode; event: ItemEvent }
  wall: { node: WallNode; event: WallEvent }
  building: { node: BuildingNode; event: BuildingEvent }
  zone: { node: ZoneNode; event: ZoneEvent }
  slab: { node: SlabNode; event: SlabEvent }
}

type NodeType = keyof NodeConfig

export function useNodeEvents<T extends NodeType>(node: NodeConfig[T]['node'], type: T) {
  const emit = (suffix: EventSuffix, e: ThreeEvent<PointerEvent>) => {
    const eventKey = `${type}:${suffix}` as `${T}:${EventSuffix}`
    const localPoint = e.object.worldToLocal(e.point.clone())
    const payload = {
      node,
      position: [e.point.x, e.point.y, e.point.z],
      localPosition: [localPoint.x, localPoint.y, localPoint.z],
      normal: e.face ? [e.face.normal.x, e.face.normal.y, e.face.normal.z] : undefined,
      stopPropagation: () => e.stopPropagation(),
      nativeEvent: e,
    } as NodeConfig[T]['event']

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
