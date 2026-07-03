import type {
  HandleDescriptor,
  NodeDefinition,
  WindowNode as WindowNodeType,
} from '@pascal-app/core'
import { buildWindowFloorplan } from './floorplan'
import { windowFloorplanMoveTarget } from './floorplan-move'
import { windowParametrics } from './parametrics'
import { WindowNode } from './schema'

const MOVE_HANDLE_LIFT = 0.12

function windowMoveHandle(): HandleDescriptor<WindowNodeType> {
  return {
    kind: 'tap-action',
    shape: 'move-cross',
    plane: 'node-normal',
    portal: 'grandparent',
    cursor: 'move',
    onActivate: (node, _scene, editor) => editor.engageMoveDrag(node),
    placement: {
      position: () => [0, 0, MOVE_HANDLE_LIFT],
    },
  }
}

/**
 * Window — Phase 5 batch kind. Mirrors door's shape: hosted on walls,
 * cuts holes in them, animated open/close state for opening windows.
 *
 * Stages:
 *  - A: registered.
 *  - B: deferred — window geometry ~800 lines; extraction is a focused
 *    session. `def.renderer` + `def.system` wrap-export legacy.
 *  - C: `def.floorplan` polygon sits in parent wall's cutout. Legacy
 *    `openingPolygons` short-circuits window entries when registered.
 */
export const windowDefinition: NodeDefinition<typeof WindowNode> = {
  kind: 'window',
  schemaVersion: 1,
  schema: WindowNode,
  category: 'structure',

  // Same schema-driven defaults trick as door: parse a stub, strip
  // id/type. Window also has many fields with zod `.default()` set.
  defaults: () => {
    const stub = WindowNode.parse({ id: 'window_default' as never, type: 'window' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    sceneSelection: { role: 'zone-content', levelParentKinds: ['wall'] },
    duplicable: true,
    deletable: true,
  },

  parametrics: windowParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  // Stage C: floor-plan polygon. ctx.parent gives the wall for direction
  // + thickness — same shape as door.
  floorplan: buildWindowFloorplan,
  handles: [windowMoveHandle()],
  // Stage D — placement + move-on-wall. Same recipe as door. See
  // `nodes/src/window/{tool,move-tool,window-math}.ts`.
  tool: () => import('./tool'),
  affordanceTools: {
    move: () => import('./move-tool'),
  },
  // 2D move-on-floorplan handler — same shape as door.
  floorplanMoveTarget: windowFloorplanMoveTarget,

  toolHints: [
    { key: 'Left click', label: '放置窗户' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Window',
    description: 'A window cut into a wall. Animated open/close for opening windows.',
    icon: { kind: 'url', src: '/icons/window.webp' },
    paletteSection: 'structure',
    paletteOrder: 60,
  },

  mcp: {
    description: 'A window mounted on a wall, with type / dimensions / opening options.',
  },
}
