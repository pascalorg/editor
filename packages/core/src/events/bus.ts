// The emitter itself (if you need direct access)
// emitter: Emitter<EditorEvents>

// // Typed on method
// on: <K extends keyof EditorEvents>(
//   event: K,
//   handler: (data: EditorEvents[K]) => void
// ) => () => void
// // Typed emit method
// emit: <K extends keyof EditorEvents>(
//   event: K,
//   data: EditorEvents[K]
// ) => void

import mitt from 'mitt'
import type {
  AnyNode,
  CeilingNode,
  GridPoint,
  ImageNode,
  WallNode,
} from '../scenegraph/schema/index'

export interface GridEvent {
  position: [number, number]
}

export interface NodeEvent {
  node: AnyNode
  gridPosition: GridPoint
  position: [number, number, number] // [x, y, z] world coordinates
  normal?: [number, number, number] // [x, y, z] normal vector
  stopPropagation: () => void
}

export interface WallEvent extends NodeEvent {
  node: WallNode
}

export interface CeilingEvent extends NodeEvent {
  node: CeilingNode
}

export interface ImageEvent {
  node: ImageNode
}

export interface ImageUpdateEvent {
  nodeId: string
  updates: Partial<{
    position: [number, number]
    rotation: [number, number, number]
    scale: number
  }>
  pushToUndo: boolean
}

export interface ImageManipulationEvent {
  nodeId: string
}

export interface ScanUpdateEvent {
  nodeId: string
  updates: Partial<{
    position: [number, number, number]
    rotation: [number, number, number]
    scale: number
    yOffset: number
  }>
  pushToUndo: boolean
}

export interface ScanManipulationEvent {
  nodeId: string
}

export interface ViewCaptureRequest {
  name: string
  description?: string
}

export interface ViewApplyEvent {
  camera: {
    position: [number, number, number]
    target: [number, number, number]
    mode: 'perspective' | 'orthographic'
    fov?: number
    zoom?: number
  }
}

export interface NodeCameraCaptureRequest {
  nodeId: string
}

export interface InteractionClickEvent {
  type: 'node' | 'zone' | 'level' | 'building' | 'void'
  id: string | null
  data?: any
}

export interface ZonePreviewEvent {
  points: Array<[number, number]>
  cursorPoint?: [number, number] | null
}

type EditorEvents = {
  'grid:click': GridEvent
  'grid:rightclick': GridEvent
  'grid:move': GridEvent
  'grid:double-click': GridEvent
  'grid:enter': GridEvent
  'grid:leave': GridEvent
  'grid:pointerdown': GridEvent
  'grid:pointerup': GridEvent
  'wall:click': WallEvent
  'wall:move': WallEvent
  'wall:enter': WallEvent
  'wall:leave': WallEvent
  'wall:pointerdown': WallEvent
  'wall:pointerup': WallEvent
  'ceiling:click': CeilingEvent
  'ceiling:move': CeilingEvent
  'ceiling:enter': CeilingEvent
  'ceiling:leave': CeilingEvent
  'image:select': ImageEvent
  'image:update': ImageUpdateEvent
  'image:manipulation-start': ImageManipulationEvent
  'image:manipulation-end': ImageManipulationEvent
  'scan:update': ScanUpdateEvent
  'scan:manipulation-start': ScanManipulationEvent
  'scan:manipulation-end': ScanManipulationEvent
  'view:request-capture': ViewCaptureRequest
  'view:apply': ViewApplyEvent
  'node:capture-camera': NodeCameraCaptureRequest
  'interaction:click': InteractionClickEvent
  'zone:preview': ZonePreviewEvent
  'tool:cancel': undefined
}
export const emitter = mitt<EditorEvents>()
