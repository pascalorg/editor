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

  import { BaseNode, WallNode } from '@/hooks/use-editor'
import mitt from 'mitt'


  export interface GridEvent {
    position: [number, number]
  }
  
  export interface NodeEvent {
    node: BaseNode
    position: [number, number, number ] // [x, y, z] world coordinates
    gridPosition: [number, number] // [x, y] grid coordinates
  }

  interface WallEvent extends NodeEvent {
    node: WallNode
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
  }
  export const emitter = mitt<EditorEvents>()