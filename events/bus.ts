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
import type { BaseNode, ReferenceImageNode, WallNode } from '@/hooks/use-editor'
import type { GridPoint } from '@/lib/nodes/types'

export interface GridEvent {
  position: [number, number]
}

export interface NodeEvent {
  node: BaseNode
  gridPosition: GridPoint
  position: [number, number, number] // [x, y, z] world coordinates
}

export interface WallEvent extends NodeEvent {
  node: WallNode
}

export interface ImageEvent {
  node: ReferenceImageNode
}

export interface ImageUpdateEvent {
  nodeId: string
  updates: Partial<{ position: [number, number]; rotation: number; scale: number }>
  pushToUndo: boolean
}

export interface ImageManipulationEvent {
  nodeId: string
}

export interface ScanUpdateEvent {
  nodeId: string
  updates: Partial<{ position: [number, number]; rotation: number; scale: number; yOffset: number }>
  pushToUndo: boolean
}

export interface ScanManipulationEvent {
  nodeId: string
}

type EditorEvents = {
  'grid:click': GridEvent
  'grid:move': GridEvent
  'grid:double-click': GridEvent
  'grid:enter': GridEvent
  'grid:leave': GridEvent
  'wall:click': WallEvent
  'wall:move': WallEvent
  'wall:enter': WallEvent
  'wall:leave': WallEvent
  'image:select': ImageEvent
  'image:update': ImageUpdateEvent
  'image:manipulation-start': ImageManipulationEvent
  'image:manipulation-end': ImageManipulationEvent
  'scan:update': ScanUpdateEvent
  'scan:manipulation-start': ScanManipulationEvent
  'scan:manipulation-end': ScanManipulationEvent
}
export const emitter = mitt<EditorEvents>()
