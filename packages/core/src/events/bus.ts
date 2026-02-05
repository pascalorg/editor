import type { ThreeEvent } from '@react-three/fiber'
import mitt from 'mitt'
import type { BuildingNode, CeilingNode, ItemNode, LevelNode, RoofNode, SlabNode, WallNode, ZoneNode } from '../schema'
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
export type LevelEvent = NodeEvent<LevelNode>
export type ZoneEvent = NodeEvent<ZoneNode>
export type SlabEvent = NodeEvent<SlabNode>
export type CeilingEvent = NodeEvent<CeilingNode>
export type RoofEvent = NodeEvent<RoofNode>

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
  'camera-controls:top-view': undefined
  'camera-controls:orbit-cw': undefined
  'camera-controls:orbit-ccw': undefined
}

type EditorEvents = GridEvents &
  NodeEvents<'wall', WallEvent> &
  NodeEvents<'item', ItemEvent> &
  NodeEvents<'building', BuildingEvent> &
  NodeEvents<'level', LevelEvent> &
  NodeEvents<'zone', ZoneEvent> &
  NodeEvents<'slab', SlabEvent> &
  NodeEvents<'ceiling', CeilingEvent> &
  NodeEvents<'roof', RoofEvent> &
  CameraControlEvents

export const emitter = mitt<EditorEvents>()
