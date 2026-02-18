import {
  type BuildingEvent,
  type BuildingNode,
  type CeilingEvent,
  type CeilingNode,
  type EventSuffix,
  emitter,
  type ItemEvent,
  type ItemNode,
  type LevelEvent,
  type LevelNode,
  type RoofEvent,
  type RoofNode,
  type SiteEvent,
  type SiteNode,
  type SlabEvent,
  type SlabNode,
  type WallEvent,
  type WallNode,
  type WindowEvent,
  type WindowNode,
  type ZoneEvent,
  type ZoneNode,
} from '@pascal-app/core'
import type { ThreeEvent } from '@react-three/fiber'
import useViewer from '../store/use-viewer'

type NodeConfig = {
  site: { node: SiteNode; event: SiteEvent }
  item: { node: ItemNode; event: ItemEvent }
  wall: { node: WallNode; event: WallEvent }
  building: { node: BuildingNode; event: BuildingEvent }
  level: { node: LevelNode; event: LevelEvent }
  zone: { node: ZoneNode; event: ZoneEvent }
  slab: { node: SlabNode; event: SlabEvent }
  ceiling: { node: CeilingNode; event: CeilingEvent }
  roof: { node: RoofNode; event: RoofEvent }
  window: { node: WindowNode; event: WindowEvent }
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
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('pointerdown', e)
    },
    onPointerUp: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('pointerup', e)
    },
    onClick: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      if (e.button !== 0) return
      emit('click', e)
    },
    onPointerEnter: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      emit('enter', e)
    },
    onPointerLeave: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      emit('leave', e)
    },
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      emit('move', e)
    },
    onDoubleClick: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      emit('double-click', e)
    },
    onContextMenu: (e: ThreeEvent<PointerEvent>) => {
      if (useViewer.getState().cameraDragging) return
      emit('context-menu', e)
    },
  }
}
