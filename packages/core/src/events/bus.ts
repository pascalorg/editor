import type { ThreeEvent } from '@react-three/fiber'
import mitt from 'mitt'
import type { Object3D } from 'three'
import type {
  BoxVentNode,
  BuildingNode,
  CeilingNode,
  ChimneyNode,
  ColumnNode,
  CupolaNode,
  DoorNode,
  DormerNode,
  DownspoutNode,
  DuctFittingNode,
  DuctSegmentNode,
  DuctTerminalNode,
  ElevatorNode,
  EyebrowVentNode,
  FenceNode,
  GuideNode,
  GutterNode,
  HvacEquipmentNode,
  ItemNode,
  LevelNode,
  LinesetNode,
  LiquidLineNode,
  PipeFittingNode,
  PipeSegmentNode,
  PipeTrapNode,
  RidgeVentNode,
  RoofNode,
  RoofSegmentNode,
  ScanNode,
  ShelfNode,
  SiteNode,
  SkylightNode,
  SlabNode,
  SolarPanelNode,
  SpawnNode,
  StairNode,
  StairSegmentNode,
  TurbineVentNode,
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
   * Building-local intersection point — relative to the currently selected building.
   * Equals `position` when no building is selected.
   * Use this for placing/committing anything that lives inside a building (walls, slabs, items, etc.).
   */
  localPosition: [number, number, number]
  faceIndex?: number
  /**
   * Optional: the hit Three.js object. Present when the grid event was
   * synthesized from a R3F mesh hit (the legacy grid-plane mesh path);
   * absent when emitted by the canvas-level raycaster in
   * `use-grid-events.ts`, where there is no specific mesh to attribute
   * the intersection to.
   */
  object?: Object3D
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
  // Set when the click originated from a dedicated selection affordance
  // (e.g. a ceiling corner handle) rather than the node's own surface
  // mesh. Lets selection logic accept handle clicks while ignoring clicks
  // on the body so they fall through to whatever sits below.
  viaHandle?: boolean
}

export type WallEvent = NodeEvent<WallNode>
export type FenceEvent = NodeEvent<FenceNode>
export type ItemEvent = NodeEvent<ItemNode>
export type SiteEvent = NodeEvent<SiteNode>
export type BuildingEvent = NodeEvent<BuildingNode>
export type LevelEvent = NodeEvent<LevelNode>
export type ZoneEvent = NodeEvent<ZoneNode>
export type ShelfEvent = NodeEvent<ShelfNode>
export type SlabEvent = NodeEvent<SlabNode>
export type SpawnEvent = NodeEvent<SpawnNode>
export type CeilingEvent = NodeEvent<CeilingNode>
export type ColumnEvent = NodeEvent<ColumnNode>
export type RoofEvent = NodeEvent<RoofNode>
export type RoofSegmentEvent = NodeEvent<RoofSegmentNode>
export type StairEvent = NodeEvent<StairNode>
export type StairSegmentEvent = NodeEvent<StairSegmentNode>
export type WindowEvent = NodeEvent<WindowNode>
export type DoorEvent = NodeEvent<DoorNode>
export type ElevatorEvent = NodeEvent<ElevatorNode>
export type ScanEvent = NodeEvent<ScanNode>
export type GuideEvent = NodeEvent<GuideNode>
export type BoxVentEvent = NodeEvent<BoxVentNode>
export type RidgeVentEvent = NodeEvent<RidgeVentNode>
export type TurbineVentEvent = NodeEvent<TurbineVentNode>
export type CupolaEvent = NodeEvent<CupolaNode>
export type EyebrowVentEvent = NodeEvent<EyebrowVentNode>
export type GutterEvent = NodeEvent<GutterNode>
export type ChimneyEvent = NodeEvent<ChimneyNode>
export type SolarPanelEvent = NodeEvent<SolarPanelNode>
export type SkylightEvent = NodeEvent<SkylightNode>
export type DormerEvent = NodeEvent<DormerNode>
export type DownspoutEvent = NodeEvent<DownspoutNode>
export type DuctSegmentEvent = NodeEvent<DuctSegmentNode>
export type DuctFittingEvent = NodeEvent<DuctFittingNode>
export type DuctTerminalEvent = NodeEvent<DuctTerminalNode>
export type HvacEquipmentEvent = NodeEvent<HvacEquipmentNode>
export type PipeSegmentEvent = NodeEvent<PipeSegmentNode>
export type PipeFittingEvent = NodeEvent<PipeFittingNode>
export type PipeTrapEvent = NodeEvent<PipeTrapNode>
export type LinesetEvent = NodeEvent<LinesetNode>
export type LiquidLineEvent = NodeEvent<LiquidLineNode>

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

export interface ThumbnailGenerateEvent {
  projectId: string
  captureMode?: 'standard' | 'viewport' | 'area'
  cropRegion?: { x: number; y: number; width: number; height: number }
  /**
   * Output size for `standard` captures (center-crop target). Defaults to
   * 1920×1080; the capture overlay passes other aspect presets (9:16, 4:3…).
   */
  standardSize?: { w: number; h: number }
  /**
   * When true, snap levels to their true positions before capturing (for a
   * consistent auto-thumbnail angle) and defer the capture if the tab is
   * hidden — the background auto-save path. Omit for user-driven captures
   * that should fire immediately from the current camera pose.
   */
  snapLevels?: boolean
  /**
   * When true, keep the rendered alpha channel — emits a transparent PNG
   * without baking the scene background into the output. Used by the
   * preset capture flow so saved preset thumbnails composite cleanly on
   * any palette background.
   */
  transparent?: boolean
}

export interface CameraControlFitSceneEvent {
  /**
   * XZ-plane axis-aligned bounds of the scene's geometry, computed from the
   * scene graph (see `@pascal-app/editor`'s `computeSceneBoundsXZ`). The
   * viewer's camera-controls listener frames the camera onto this box.
   * Omitted values fall back to the camera's default pose.
   */
  bounds?: {
    min: [number, number]
    max: [number, number]
    center: [number, number]
    size: [number, number]
  }
}

type CameraControlEvents = {
  'camera-controls:view': CameraControlEvent
  'camera-controls:focus': CameraControlEvent
  'camera-controls:capture': CameraControlEvent
  'camera-controls:top-view': undefined
  'camera-controls:orbit-cw': undefined
  'camera-controls:orbit-ccw': undefined
  'camera-controls:fit-scene': CameraControlFitSceneEvent
  'camera-controls:generate-thumbnail': ThumbnailGenerateEvent
}

type ToolEvents = {
  'tool:cancel': undefined
}

type GuideEvents = {
  'guide:set-reference-scale': { guideId: GuideNode['id'] }
  'guide:cancel-reference-scale': undefined
  'guide:deleted': { guideId: GuideNode['id'] }
}

type DoorAnimationEvents = {
  'door:animation-completed': {
    doorId: DoorNode['id']
    field: 'operationState' | 'swingAngle'
  }
}

type WindowAnimationEvents = {
  'window:animation-completed': {
    windowId: WindowNode['id']
    field: 'operationState'
  }
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

export interface RoomPresetCreateEvent {
  zoneId: ZoneNode['id']
}

type RoomPresetEvents = {
  'room-preset:create': RoomPresetCreateEvent
}

type EditorEvents = GridEvents &
  NodeEvents<'wall', WallEvent> &
  NodeEvents<'fence', FenceEvent> &
  NodeEvents<'item', ItemEvent> &
  NodeEvents<'site', SiteEvent> &
  NodeEvents<'building', BuildingEvent> &
  NodeEvents<'elevator', ElevatorEvent> &
  NodeEvents<'level', LevelEvent> &
  NodeEvents<'zone', ZoneEvent> &
  NodeEvents<'slab', SlabEvent> &
  NodeEvents<'shelf', ShelfEvent> &
  NodeEvents<'spawn', SpawnEvent> &
  NodeEvents<'ceiling', CeilingEvent> &
  NodeEvents<'column', ColumnEvent> &
  NodeEvents<'roof', RoofEvent> &
  NodeEvents<'roof-segment', RoofSegmentEvent> &
  NodeEvents<'stair', StairEvent> &
  NodeEvents<'stair-segment', StairSegmentEvent> &
  NodeEvents<'window', WindowEvent> &
  NodeEvents<'door', DoorEvent> &
  NodeEvents<'scan', ScanEvent> &
  NodeEvents<'guide', GuideEvent> &
  NodeEvents<'box-vent', BoxVentEvent> &
  NodeEvents<'ridge-vent', RidgeVentEvent> &
  NodeEvents<'turbine-vent', TurbineVentEvent> &
  NodeEvents<'cupola', CupolaEvent> &
  NodeEvents<'eyebrow-vent', EyebrowVentEvent> &
  NodeEvents<'gutter', GutterEvent> &
  NodeEvents<'chimney', ChimneyEvent> &
  NodeEvents<'solar-panel', SolarPanelEvent> &
  NodeEvents<'skylight', SkylightEvent> &
  NodeEvents<'dormer', DormerEvent> &
  NodeEvents<'downspout', DownspoutEvent> &
  NodeEvents<'duct-segment', DuctSegmentEvent> &
  NodeEvents<'duct-fitting', DuctFittingEvent> &
  NodeEvents<'duct-terminal', DuctTerminalEvent> &
  NodeEvents<'hvac-equipment', HvacEquipmentEvent> &
  NodeEvents<'pipe-segment', PipeSegmentEvent> &
  NodeEvents<'pipe-fitting', PipeFittingEvent> &
  NodeEvents<'pipe-trap', PipeTrapEvent> &
  NodeEvents<'lineset', LinesetEvent> &
  NodeEvents<'liquid-line', LiquidLineEvent> &
  CameraControlEvents &
  ToolEvents &
  GuideEvents &
  DoorAnimationEvents &
  WindowAnimationEvents &
  ThumbnailEvents &
  SnapshotEvents &
  AIChatEvents &
  RoomPresetEvents

export const emitter = mitt<EditorEvents>()
