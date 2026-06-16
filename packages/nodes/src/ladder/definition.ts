import type { NodeDefinition } from '@pascal-app/core'
import { buildLadderFloorplan } from './floorplan'
import { buildLadderGeometry } from './geometry'
import { ladderParametrics } from './parametrics'
import { LadderNode } from './schema'

export const ladderDefinition: NodeDefinition<typeof LadderNode> = {
  kind: 'ladder',
  schemaVersion: 1,
  schema: LadderNode,
  category: 'structure',

  defaults: () => ({
    object: 'node',
    parentId: null,
    visible: true,
    metadata: {},
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    height: 3,
    width: 0.55,
    railDiameter: 0.04,
    rungDiameter: 0.03,
    rungSpacing: 0.3,
    standoffDepth: 0.16,
    cageEnabled: false,
    cageRadius: 0.42,
    cageStartHeight: 1.8,
    color: '#8a9098',
  }),

  capabilities: {
    selectable: { hitVolume: 'bbox' },
    movable: { axes: ['x', 'z'], gridSnap: true },
    rotatable: {
      axes: ['y'],
      snapAngles: [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI],
    },
    duplicable: true,
    deletable: true,
    floorPlaced: {
      footprint: (node) => {
        const ladder = node as LadderNode
        return {
          dimensions: [ladder.width, ladder.height, Math.max(0.2, ladder.standoffDepth + 0.12)] as [
            number,
            number,
            number,
          ],
          rotation: ladder.rotation,
        }
      },
    },
  },

  parametrics: ladderParametrics,
  tool: () => import('./tool'),
  geometry: buildLadderGeometry,
  floorplan: buildLadderFloorplan,

  toolHints: [
    { key: 'Left click', label: '放置爬梯' },
    { key: 'Esc', label: '取消' },
  ],

  presentation: {
    label: 'Ladder',
    description: 'An editable industrial access ladder with rung and safety-cage controls.',
    icon: { kind: 'url', src: '/icons/stairs.png' },
    paletteSection: 'structure',
    paletteOrder: 22,
  },

  mcp: {
    description:
      'Vertical access ladder with editable height, width, rung spacing, standoff depth, and optional cage.',
  },
}
