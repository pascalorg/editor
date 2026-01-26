import type { ThreeEvent } from '@react-three/fiber'
import mitt from 'mitt'
import type { BuildingNode, ItemNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNode } from '../schema/types'

// Base event interfaces
export interface GridEvent {
  position: [number, number, number]
  nativeEvent: ThreeEvent<PointerEvent>
}

export interface NodeEvent<T extends AnyNode = AnyNode> {
  node: T
  position: [number, number, number]
  localPosition: [number, number, number]
  normal?: [number, number, number]
  stopPropagation: () => void
  nativeEvent: ThreeEvent<PointerEvent>
}

export type WallEvent = NodeEvent<WallNode>
export type ItemEvent = NodeEvent<ItemNode>
export type BuildingEvent = NodeEvent<BuildingNode>
export type ZoneEvent = NodeEvent<ZoneNode>
export type SlabEvent = NodeEvent<SlabNode>

// Event suffixes - exported for use in hooks
export const eventSuffixes = [
  'click',
  'move',
  'enter',
  'leave',
  'pointerdown',
  'pointerup',
  'context-menu',
  'double-click',
] as const

export type EventSuffix = (typeof eventSuffixes)[number]

type NodeEvents<T extends string, E> = {
  [K in `${T}:${EventSuffix}`]: E
}

type GridEvents = {
  [K in `grid:${EventSuffix}`]: GridEvent
}

export interface CameraControlEvent {
  nodeId: AnyNode['id']
}

type CameraControlEvents = {
  'camera-controls:view': CameraControlEvent
  'camera-controls:capture': CameraControlEvent
}

type EditorEvents = GridEvents &
  NodeEvents<'wall', WallEvent> &
  NodeEvents<'item', ItemEvent> &
  NodeEvents<'building', BuildingEvent> &
  NodeEvents<'zone', ZoneEvent> &
  CameraControlEvents

export const emitter = mitt<EditorEvents>()
