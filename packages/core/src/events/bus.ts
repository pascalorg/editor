import type { ThreeEvent } from '@react-three/fiber'
import type { Object3D } from 'three'
import mitt from 'mitt'
import type {
  BuildingNode,
  CeilingNode,
  DoorNode,
  FenceNode,
  ItemNode,
  LevelNode,
  RoofNode,
  RoofSegmentNode,
  SiteNode,
  SlabNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
  WallNode,
  WindowNode,
  ZoneNode,
} from '../schema'
import type { AnyNode } from '../schema/types'

// Base event interfaces
export interface GridEvent {
  /** World-space intersection point on the grid plane. */
  position: [number, number, number]
  /**
   * Building-local intersection point, relative to the currently selected building.
   * Equals `position` when no building is selected.
   * Use this for placing or committing anything that lives inside a building
   * (walls, slabs, items, etc.).
   */
  localPosition: [number, number, number]
  nativeEvent: ThreeEvent<PointerEvent>
}

export interface NodeEvent<T extends AnyNode = AnyNode> {
  node: T
  position: [number, number, number]
  localPosition: [number, number, number]
  normal?: [number, number, number]
  faceIndex?: number
  object: Object3D
  stopPropagation: () => void
  nativeEvent: ThreeEvent<PointerEvent>
}

export type WallEvent = NodeEvent<WallNode>
export type FenceEvent = NodeEvent<FenceNode>
export type ItemEvent = NodeEvent<ItemNode>
export type SiteEvent = NodeEvent<SiteNode>
export type BuildingEvent = NodeEvent<BuildingNode>
export type LevelEvent = NodeEvent<LevelNode>
export type ZoneEvent = NodeEvent<ZoneNode>
export type SlabEvent = NodeEvent<SlabNode>
export type SpawnEvent = NodeEvent<SpawnNode>
export type CeilingEvent = NodeEvent<CeilingNode>
export type RoofEvent = NodeEvent<RoofNode>
export type RoofSegmentEvent = NodeEvent<RoofSegmentNode>
export type StairEvent = NodeEvent<StairNode>
export type StairSegmentEvent = NodeEvent<StairSegmentNode>
export type WindowEvent = NodeEvent<WindowNode>
export type DoorEvent = NodeEvent<DoorNode>

// Event suffixes, exported for use in hooks
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

export interface ThumbnailGenerateEvent {
  projectId: string
  captureMode?: 'standard' | 'viewport' | 'area'
  cropRegion?: { x: number; y: number; width: number; height: number }
  /**
   * When true, snap levels to their true positions before capturing (for a
   * consistent auto-thumbnail angle) and defer the capture if the tab is
   * hidden, the background auto-save path. Omit for user-driven captures
   * that should fire immediately from the current camera pose.
   */
  snapLevels?: boolean
}

type CameraControlEvents = {
  'camera-controls:view': CameraControlEvent
  'camera-controls:focus': CameraControlEvent
  'camera-controls:capture': CameraControlEvent
  'camera-controls:top-view': undefined
  'camera-controls:orbit-cw': undefined
  'camera-controls:orbit-ccw': undefined
  'camera-controls:generate-thumbnail': ThumbnailGenerateEvent
}

type ToolEvents = {
  'tool:cancel': undefined
}

type PresetEvents = {
  'preset:generate-thumbnail': { presetId: string; nodeId: string }
  'preset:thumbnail-updated': { presetId: string; thumbnailUrl: string }
}

type ThumbnailEvents = {
  'thumbnail:before-capture': undefined
  'thumbnail:after-capture': undefined
}

type SnapshotEvents = {
  'snapshot:saved': undefined
  'camera:go-to-position': { position: [number, number, number]; target: [number, number, number] }
}

type AIChatEvents = {
  'ai-chat:attach-images': {
    images: { url: string; name: string; kind: 'snapshot' | 'render' }[]
  }
}

type EditorEvents = GridEvents &
  NodeEvents<'wall', WallEvent> &
  NodeEvents<'fence', FenceEvent> &
  NodeEvents<'item', ItemEvent> &
  NodeEvents<'site', SiteEvent> &
  NodeEvents<'building', BuildingEvent> &
  NodeEvents<'level', LevelEvent> &
  NodeEvents<'zone', ZoneEvent> &
  NodeEvents<'slab', SlabEvent> &
  NodeEvents<'spawn', SpawnEvent> &
  NodeEvents<'ceiling', CeilingEvent> &
  NodeEvents<'roof', RoofEvent> &
  NodeEvents<'roof-segment', RoofSegmentEvent> &
  NodeEvents<'stair', StairEvent> &
  NodeEvents<'stair-segment', StairSegmentEvent> &
  NodeEvents<'window', WindowEvent> &
  NodeEvents<'door', DoorEvent> &
  CameraControlEvents &
  ToolEvents &
  PresetEvents &
  ThumbnailEvents &
  SnapshotEvents &
  AIChatEvents

export const emitter = mitt<EditorEvents>()
