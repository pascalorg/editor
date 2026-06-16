import { type NodeDefinition, PipeFittingNode as PipeFittingNodeSchema } from '@pascal-app/core'
import { buildPipeFittingFloorplan } from './floorplan'
import { buildPipeFittingGeometry } from './geometry'
import { pipeFittingParametrics } from './parametrics'
import { PipeFittingNode } from './schema'

export const pipeFittingDefinition: NodeDefinition<typeof PipeFittingNode> = {
  kind: 'pipe-fitting',
  schemaVersion: 1,
  schema: PipeFittingNode,
  category: 'structure',

  defaults: () => {
    const stub = PipeFittingNodeSchema.parse({
      id: 'pipe-fitting_default' as never,
      type: 'pipe-fitting',
    })
    const { id: _id, type: _type, ...rest } = stub
    return rest
  },

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
    movable: { axes: ['x', 'z'] as const },
    rotatable: { axes: ['y'] as const },
    snappable: { points: ['start', 'end', 'center'] as const },
  },

  parametrics: pipeFittingParametrics,
  geometry: buildPipeFittingGeometry,
  floorplan: buildPipeFittingFloorplan,
  tool: () => import('./tool'),

  toolHints: [
    { key: 'Left click', label: '放置管件' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Pipe fitting',
    description: 'Industrial elbows, tees, crosses, flanges, and valves.',
    icon: { kind: 'url', src: '/icons/pipe-fitting.svg' },
    paletteSection: 'structure',
    paletteOrder: 19,
  },

  mcp: {
    description: 'Industrial pipe fitting: elbow, tee, cross, bolted flange, or valve placeholder.',
  },
}
