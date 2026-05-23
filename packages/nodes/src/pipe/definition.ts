import type { NodeDefinition } from '@pascal-app/core'
import { buildPipeFloorplan } from './floorplan'
import { buildPipeGeometry } from './geometry'
import { pipeParametrics } from './parametrics'
import { PipeNode } from './schema'

export const pipeDefinition: NodeDefinition<typeof PipeNode> = {
  kind: 'pipe',
  schemaVersion: 1,
  schema: PipeNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    start: [0, 0],
    end: [4, 0],
    diameter: 0.15,
    elevation: 3,
    rotate: 0,
    insulated: true,
    insulationThickness: 0.05,
    pressureKpa: 100,
    temperatureC: 180,
    medium: 'steam',
    showHangers: true,
    hangerSpacing: 2,
    color: '#b0b8c0',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    duplicable: true,
    deletable: true,
  },

  relations: {
    linkedBy: 'endpoint-match',
    cascadeDelete: 'none',
  },

  parametrics: pipeParametrics,

  tool: () => import('./tool'),

  geometry: buildPipeGeometry,
  floorplan: buildPipeFloorplan,

  affordanceTools: {
    curve: () => import('./curve-tool'),
    'move-endpoint': () => import('./move-endpoint-tool'),
    move: () => import('./move-tool'),
  },

  toolHints: [
    { key: 'Left click', label: 'Set pipe start / end' },
    { key: 'Shift', label: 'Allow non-45° angles' },
    { key: 'Esc', label: 'Cancel' },
  ],

  presentation: {
    label: 'Pipe',
    description: 'Steam / utility pipe — plan path with elevation and rotate (90° = vertical).',
    icon: { kind: 'url', src: '/icons/custom-room.png' },
    paletteSection: 'structure',
    paletteOrder: 18,
  },

  mcp: {
    description:
      'Pipe segment with diameter, elevation, rotate tilt, insulation, and process metadata.',
  },
}
