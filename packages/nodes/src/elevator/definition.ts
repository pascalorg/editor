import { ElevatorNode as ElevatorNodeSchema, type NodeDefinition } from '@pascal-app/core'
import { buildElevatorFloorplan } from './floorplan'
import { elevatorParametrics } from './parametrics'
import { ElevatorNode } from './schema'

/**
 * Elevator — Stage A registration. Wrap-exports the legacy renderer +
 * the three legacy systems (runtime / interaction / opening) bundled
 * as one `def.system`. Move / inspector still go through legacy
 * (`MoveElevatorTool`, `<ElevatorPanel>`) via panel-manager's
 * hardcoded switch.
 */
export const elevatorDefinition: NodeDefinition<typeof ElevatorNode> = {
  kind: 'elevator',
  schemaVersion: 1,
  schema: ElevatorNode,
  category: 'structure',

  defaults: () => {
    const stub = ElevatorNodeSchema.parse({ id: 'elevator_default' as never, type: 'elevator' })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  parametrics: elevatorParametrics,

  renderer: {
    kind: 'parametric',
    module: () => import('./renderer'),
  },
  system: {
    module: () => import('./system'),
    priority: 3,
  },
  floorplan: buildElevatorFloorplan,

  toolHints: [
    { key: 'Left click', label: '放置电梯' },
    { key: 'R', label: '顺时针旋转' },
    { key: 'T', label: '逆时针旋转' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Elevator',
    description: 'A multi-level elevator shaft with configurable openings per level.',
    icon: { kind: 'url', src: '/icons/wallcut.webp' },
    paletteSection: 'structure',
    paletteOrder: 80,
  },

  mcp: {
    description: 'A multi-level elevator with shaft + openings per level.',
  },
}
