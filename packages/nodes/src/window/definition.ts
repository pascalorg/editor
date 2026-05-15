import type { NodeDefinition } from '@pascal-app/core'
import { windowParametrics } from './parametrics'
import { WindowNode } from './schema'

/**
 * Window — Phase 5 batch kind. Mirrors door's shape: hosted on walls,
 * cuts holes in them, animated open/close state for opening windows.
 *
 * Capabilities: no `movable` (wall-bound drag is bespoke). Tool field
 * absent (legacy WindowTool / MoveWindowTool continue).
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

  toolHints: [
    { key: 'Left click', label: 'Place window on wall' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Window',
    description: 'A window cut into a wall. Animated open/close for opening windows.',
    icon: { kind: 'iconify', name: 'lucide:rectangle-horizontal' },
    paletteSection: 'structure',
    paletteOrder: 60,
  },

  mcp: {
    description: 'A window mounted on a wall, with type / dimensions / opening options.',
  },
}
